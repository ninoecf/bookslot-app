#!/usr/bin/env bash
# Configuracion compartida. Se carga con source desde los demas scripts.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SALIDA_DIR="$RAIZ/scripts/out"
mkdir -p "$SALIDA_DIR"

# Valores obtenidos de terraform output.
SALIDA="$(terraform -chdir="$RAIZ/infra" output -json)"
API_URL="$(jq -r '.api_invoke_url.value' <<<"$SALIDA")"
COGNITO_CLIENT_ID="$(jq -r '.cognito_client_id.value' <<<"$SALIDA")"
COGNITO_USER_POOL_ID="$(jq -r '.cognito_user_pool_id.value' <<<"$SALIDA")"

# La region va dentro del id del grupo de usuarios: eu-west-1_AbCdEf
COGNITO_URL="https://cognito-idp.${COGNITO_USER_POOL_ID%%_*}.amazonaws.com/"

# Token de identidad de Cognito. El authorizer del gateway valida la
# audiencia, que solo lleva el IdToken.
#
# El cliente es publico: la llamada no va firmada y no necesita IAM.
token_de() {
    curl -s -X POST "$COGNITO_URL" \
        -H 'Content-Type: application/x-amz-json-1.1' \
        -H 'X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth' \
        -d "{\"ClientId\":\"$COGNITO_CLIENT_ID\",\"AuthFlow\":\"USER_PASSWORD_AUTH\",
             \"AuthParameters\":{\"USERNAME\":\"$1\",\"PASSWORD\":\"$2\"}}" \
        | jq -r '.AuthenticationResult.IdToken'
}
