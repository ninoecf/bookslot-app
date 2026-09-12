#!/usr/bin/env bash
# Prueba de idempotencia. N peticiones con la misma clave crean una sola
# reserva: es el caso de reintentar tras un fallo de red.
#
# Uso:  ./idempotency-test.sh [intentos]
set -euo pipefail
source "$(dirname "$0")/../env.sh"

INTENTOS=${1:-20}
SLOT_ID=$(cat "$SALIDA_DIR/slot-id.txt")
RESOURCE_ID=$(cat "$SALIDA_DIR/resource-id.txt")
TOKEN=$(head -1 "$SALIDA_DIR/tokens.txt")
CLAVE=$(uuidgen)
EVIDENCIA="$RAIZ/docs/evidencias/idempotency-test.txt"
mkdir -p "$(dirname "$EVIDENCIA")"

libres() {
    curl -s "$API_URL/slots?resourceId=$RESOURCE_ID" \
        | jq -r ".[] | select(.slotId == \"$SLOT_ID\") | .remaining"
}

LIBRES_ANTES=$(libres)

{
echo "Prueba de idempotencia - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Franja:       $SLOT_ID"
echo "Clave:        $CLAVE"
echo "Intentos:     $INTENTOS  (un usuario, la misma clave)"
echo "Libres antes: $LIBRES_ANTES"
echo

CREADAS=0
REPETIDAS=0

for i in $(seq 1 "$INTENTOS"); do
    RESPUESTA=$(curl -s -w '\n%{http_code}' -X POST "$API_URL/reservations" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Idempotency-Key: $CLAVE" \
        -H 'Content-Type: application/json' \
        -d "{\"slotId\":\"$SLOT_ID\"}")

    HTTP=$(tail -1 <<<"$RESPUESTA")

    # La reserva se identifica por (franja, usuario), igual en los N intentos.
    # createdAt lo escribe la transaccion al crearla: dos valores distintos
    # significarian dos reservas.
    CREADA=$(sed '$d' <<<"$RESPUESTA" | jq -r '.reservation.createdAt // "-"')

    if [ "$HTTP" = "201" ]; then CREADAS=$((CREADAS + 1)); fi
    if [ "$HTTP" = "200" ]; then REPETIDAS=$((REPETIDAS + 1)); fi

    echo "  $i  HTTP $HTTP  $CREADA"
done

sleep 1
LIBRES_DESPUES=$(libres)
CONSUMIDAS=$((LIBRES_ANTES - LIBRES_DESPUES))

echo
echo "Creadas (201):          $CREADAS"
echo "Repetidas (200):        $REPETIDAS"
echo "Plazas consumidas:      $CONSUMIDAS"
echo

if [ "$CREADAS" = "1" ] && [ "$REPETIDAS" = "$((INTENTOS - 1))" ] && [ "$CONSUMIDAS" = "1" ]; then
    echo "OK - idempotente: $INTENTOS intentos con la misma clave produjeron una"
    echo "reserva y consumieron una plaza."
else
    echo "FALLO - se esperaba 1 creada, $((INTENTOS - 1)) repetidas y 1 plaza consumida."
fi
} | tee "$EVIDENCIA"
