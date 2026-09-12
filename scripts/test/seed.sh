#!/usr/bin/env bash
# Crea un recurso y una franja con aforo, por la API y con un token de admin.
#
# Uso:  ./seed.sh <email-admin> <contrasena> [aforo] [minutos]
set -euo pipefail
source "$(dirname "$0")/../env.sh"

EMAIL=$1
PASSWORD=$2
AFORO=${3:-3}
MINUTOS=${4:-120}

TOKEN=$(token_de "$EMAIL" "$PASSWORD")
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "No se pudo entrar como $EMAIL"
    exit 1
fi

# date -d es de GNU y date -v de BSD.
futuro() {
    date -u -d "+$1 minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -v+"$1"M +%Y-%m-%dT%H:%M:%SZ
}

INICIO=$(futuro "$MINUTOS")
FIN=$(futuro "$((MINUTOS + 60))")

RECURSO=$(curl -s -X POST "$API_URL/admin/resources" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"name":"Sala de pruebas","timezone":"Europe/Madrid"}')

RESOURCE_ID=$(jq -r '.resourceId' <<<"$RECURSO")
if [ "$RESOURCE_ID" = "null" ]; then
    echo "Error creando el recurso: $RECURSO"
    exit 1
fi

FRANJA=$(curl -s -X POST "$API_URL/admin/slots" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"resourceId\":\"$RESOURCE_ID\",\"startsAt\":\"$INICIO\",\"endsAt\":\"$FIN\",\"capacity\":$AFORO}")

SLOT_ID=$(jq -r '.slotId' <<<"$FRANJA")
if [ "$SLOT_ID" = "null" ]; then
    echo "Error creando la franja: $FRANJA"
    exit 1
fi

echo "$RESOURCE_ID" > "$SALIDA_DIR/resource-id.txt"
echo "$SLOT_ID"     > "$SALIDA_DIR/slot-id.txt"

echo "Recurso: $RESOURCE_ID"
echo "Franja:  $SLOT_ID  (aforo $AFORO, empieza $INICIO)"
