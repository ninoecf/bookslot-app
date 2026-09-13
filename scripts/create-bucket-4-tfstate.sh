#!/usr/bin/env bash
# Crea el bucket de S3 donde vive el estado de Terraform. Es el unico paso que
# no gestiona Terraform: un destroy borraria el bucket con su propio estado.
#
# El perfil de AWS sale de AWS_PROFILE o de las variables de entorno.
#
# Uso:  ./create-bucket-4-tfstate.sh <bucket> [region]
set -euo pipefail

BUCKET=${1}
REGION=${2:-eu-west-1}

# Relanzar el script sobre un bucket ya creado es lo normal: se salta la
# creacion y se reaplica el resto.
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
    echo "El bucket $BUCKET ya existe."
else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION"
fi

aws s3api put-bucket-versioning --bucket "$BUCKET" --region "$REGION" \
    --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "Listo: $BUCKET en $REGION"
