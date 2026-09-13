#!/usr/bin/env bash
# Deja conectados GitHub Actions y AWS para que la pipeline pueda desplegar.
# Se lanza una sola vez.
#
# En AWS: el bucket del estado, el proveedor OIDC y el rol que asume el
# workflow. En GitHub: los dos secretos que el workflow lee.
#
# Necesita la CLI de AWS con credenciales que tengan permisos de IAM, y la CLI
# de GitHub autenticada con `gh auth login`.
#
# Uso:  ./scripts/connect-github-aws.sh <owner/repo> <correo-de-alarmas> [rama]
set -euo pipefail

REPO=${1}
CORREO=${2}
RAMA=${3:-main}

ROL="bookslot-dev-github-actions"
EMISOR="token.actions.githubusercontent.com"
REGION="eu-west-1"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CUENTA=$(aws sts get-caller-identity --query Account --output text)
PROVEEDOR="arn:aws:iam::$CUENTA:oidc-provider/$EMISOR"

# El nombre de un bucket es unico en todo AWS: lleva dentro el id de cuenta.
BUCKET="bookslot-tfstate-$CUENTA"

# --- 1. El bucket donde la pipeline guarda el estado ------------------------

"$RAIZ/scripts/create-bucket-4-tfstate.sh" "$BUCKET" "$REGION"

# --- 2. El proveedor OIDC de GitHub -----------------------------------------

if aws iam get-open-id-connect-provider \
        --open-id-connect-provider-arn "$PROVEEDOR" >/dev/null 2>&1; then
    echo "El proveedor OIDC ya existe."
else
    aws iam create-open-id-connect-provider \
        --url "https://$EMISOR" \
        --client-id-list sts.amazonaws.com
fi

# --- 3. El rol que asume el workflow ----------------------------------------

# La condicion sobre sub ata el rol a una rama. Sin ella, cualquier rama y
# cualquier pull request de un fork podrian desplegar.
cat > /tmp/bookslot-trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "$PROVEEDOR" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "$EMISOR:aud": "sts.amazonaws.com",
        "$EMISOR:sub": "repo:$REPO:ref:refs/heads/$RAMA"
      }
    }
  }]
}
JSON

if aws iam get-role --role-name "$ROL" >/dev/null 2>&1; then
    aws iam update-assume-role-policy --role-name "$ROL" \
        --policy-document file:///tmp/bookslot-trust.json
else
    aws iam create-role --role-name "$ROL" \
        --assume-role-policy-document file:///tmp/bookslot-trust.json
fi

# PowerUserAccess cubre los servicios que toca el apply y deja fuera IAM.
aws iam attach-role-policy --role-name "$ROL" \
    --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

# PowerUserAccess deja IAM fuera, y el apply crea un rol por Lambda. Estas
# acciones van acotadas a los roles del proyecto, no a toda la cuenta.
cat > /tmp/bookslot-iam.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:PassRole"
    ],
    "Resource": "arn:aws:iam::$CUENTA:role/bookslot-*"
  }]
}
JSON

aws iam put-role-policy --role-name "$ROL" \
    --policy-name "$ROL-iam" \
    --policy-document file:///tmp/bookslot-iam.json

ARN=$(aws iam get-role --role-name "$ROL" --query 'Role.Arn' --output text)

# --- 4. Los secretos del repositorio ----------------------------------------

gh secret set AWS_DEPLOY_ROLE_ARN --repo "$REPO" --body "$ARN"
gh secret set ALERT_EMAIL --repo "$REPO" --body "$CORREO"

echo
echo "Rol:  $ARN"
echo "Rama autorizada a desplegar: $RAMA"
echo "Ya puedes lanzar el workflow Deploy."
