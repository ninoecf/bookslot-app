#!/usr/bin/env bash
# Crea N usuarios de prueba y guarda un token para cada uno.
#
# Un usuario por peticion: la clave de la reserva es (franja, usuario), asi que
# la misma persona no puede reservar dos veces la misma franja.
#
# Los tokens se piden aqui: un login tarda cientos de milisegundos y romperia
# la simultaneidad de la prueba.
#
# Uso:  ./seed-users.sh [n]
set -euo pipefail
source "$(dirname "$0")/../env.sh"

N=${1:-10}
PASSWORD="Prueba-2026"
TOKENS="$SALIDA_DIR/tokens.txt"

: > "$TOKENS"

for i in $(seq 1 "$N"); do
    EMAIL="bookslot-test-$i@example.com"

    # || true: el script es idempotente y los usuarios pueden existir ya.
    aws cognito-idp admin-create-user \
        --user-pool-id "$COGNITO_USER_POOL_ID" \
        --username "$EMAIL" \
        --message-action SUPPRESS \
        --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
        >/dev/null 2>&1 || true

    aws cognito-idp admin-set-user-password \
        --user-pool-id "$COGNITO_USER_POOL_ID" \
        --username "$EMAIL" \
        --password "$PASSWORD" \
        --permanent

    token_de "$EMAIL" "$PASSWORD" >> "$TOKENS"
    echo "  usuario $i de $N"
done

echo "$N tokens en scripts/out/tokens.txt"
