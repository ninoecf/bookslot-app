#!/usr/bin/env bash
# Prueba de concurrencia. Lanza N reservas a la vez contra una franja de M
# plazas, con N mayor que M, y comprueba que se confirman exactamente M.
#
# Va por HTTPS contra la API desplegada, con N usuarios distintos.
#
# Uso:  ./concurrency-test.sh [n]
set -euo pipefail
source "$(dirname "$0")/../env.sh"

N=${1:-8}
SLOT_ID=$(cat "$SALIDA_DIR/slot-id.txt")
RESOURCE_ID=$(cat "$SALIDA_DIR/resource-id.txt")
EVIDENCIA="$RAIZ/docs/evidencias/concurrency-test.txt"
mkdir -p "$(dirname "$EVIDENCIA")"

franja() {
    curl -s "$API_URL/slots?resourceId=$RESOURCE_ID" \
        | jq -r ".[] | select(.slotId == \"$SLOT_ID\") | .$1"
}

AFORO=$(franja capacity)
LIBRES=$(franja remaining)

# La franja debe estar sin reservas.
if [ "$LIBRES" != "$AFORO" ]; then
    echo "La franja ya tiene reservas. Crea una nueva con ./seed.sh"
    exit 1
fi

# La cuenta limita las ejecuciones simultaneas de Lambda. Por encima, API
# Gateway devuelve 503 sin llegar a invocar la funcion.
CUPO=$(aws lambda get-account-settings --query 'AccountLimit.ConcurrentExecutions' --output text)
if [ "$N" -gt "$CUPO" ]; then
    echo "AVISO: pides $N peticiones y la cuenta permite $CUPO simultaneas."
fi

{
echo "Prueba de concurrencia - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "API:         $API_URL"
echo "Franja:      $SLOT_ID"
echo "Aforo:       $AFORO"
echo "Peticiones:  $N"
echo

rm -f "$SALIDA_DIR"/res-*.txt

# Se lanzan las N en segundo plano y se espera a todas. Cada peticion tarda
# unos cientos de milisegundos en ir y volver, asi que se solapan de sobra.
i=0
while read -r TOKEN; do
    i=$((i + 1))
    if [ "$i" -gt "$N" ]; then break; fi

    (
        CLAVE=$(uuidgen)
        RESPUESTA=$(curl -s -w '\n%{http_code}' -X POST "$API_URL/reservations" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Idempotency-Key: $CLAVE" \
            -H 'Content-Type: application/json' \
            -d "{\"slotId\":\"$SLOT_ID\"}")

        HTTP=$(tail -1 <<<"$RESPUESTA")
        CODIGO=$(sed '$d' <<<"$RESPUESTA" | jq -r '.code // "-"')
        echo "$HTTP $CODIGO" > "$SALIDA_DIR/res-$i.txt"
    ) &
done < "$SALIDA_DIR/tokens.txt"

wait
echo "Respuestas:"
cat "$SALIDA_DIR"/res-*.txt | sort | uniq -c

CONFIRMADAS=$(cat "$SALIDA_DIR"/res-*.txt | grep -c '^201' || true)
AGOTADAS=$(cat "$SALIDA_DIR"/res-*.txt | grep -c 'SLOT_SOLD_OUT' || true)

sleep 1
LIBRES_DESPUES=$(franja remaining)

echo
echo "Confirmadas:          $CONFIRMADAS"
echo "Rechazadas por aforo: $AGOTADAS"
echo "Plazas libres ahora:  $LIBRES_DESPUES"
echo

if [ "$CONFIRMADAS" = "$AFORO" ] && [ "$LIBRES_DESPUES" = "0" ] && [ "$AGOTADAS" = "$((N - AFORO))" ]; then
    echo "OK - sin overbooking: $CONFIRMADAS de $N peticiones simultaneas obtuvieron"
    echo "plaza, que es exactamente el aforo."
else
    echo "FALLO - se esperaban $AFORO confirmadas, $((N - AFORO)) rechazadas y 0 libres."
fi
} | tee "$EVIDENCIA"
