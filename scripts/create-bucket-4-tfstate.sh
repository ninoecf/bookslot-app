set -euo pipefail
 
BUCKET=${1}
REGION=${2}

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" \
    --profile academy

aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled \
    --profile academy

aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
    --profile academy

aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
    --profile academy