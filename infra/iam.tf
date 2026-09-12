# --- Rol de ejecución para las Lambdas --------------------------------------
# Asumo el IAM para las Lambdas: utilizo el de Student

data "aws_iam_role" "lambda_exec" {
  name = "studentLambdaExecutionRole"
}

# --- El rol de mínimo privilegio, que esta cuenta no deja crear -------------
#
# Queda escrito y comentado a propósito: es lo que sustituiría al rol de
# Student en una cuenta con permisos de IAM.
#
# Para activarlo: descomentar y cambiar en lambda.tf
#   role = data.aws_iam_role.lambda_exec.arn  ->  role = aws_iam_role.api.arn
#
# data "aws_iam_policy_document" "lambda_assume_role" {
#   statement {
#     actions = ["sts:AssumeRole"]
#
#     principals {
#       type        = "Service"
#       identifiers = ["lambda.amazonaws.com"]
#     }
#   }
# }
#
# resource "aws_iam_role" "api" {
#   name               = "${local.name}-api"
#   assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
# }
#
# data "aws_iam_policy_document" "api" {
#
#   statement {
#     sid = "LaTabla"
#
#     actions = [
#       "dynamodb:GetItem",
#       "dynamodb:Query",
#       "dynamodb:PutItem",
#       "dynamodb:UpdateItem",
#       "dynamodb:DeleteItem",
#     ]
#
#     resources = [
#       aws_dynamodb_table.bookslot.arn,
#       "${aws_dynamodb_table.bookslot.arn}/index/GSI1",
#     ]
#   }
#
#   # Publish y nada más: la suscripción de la notificadora la crea Terraform,
#   # no el código, así que no hace falta sns:Subscribe.
#   statement {
#     sid       = "ElAviso"
#     actions   = ["sns:Publish"]
#     resources = [aws_sns_topic.events.arn]
#   }
#
#   # Escrito a mano en lugar de adjuntar AWSLambdaBasicExecutionRole, que
#   # permite logs:* sobre *. Aquí son dos acciones sobre UN grupo.
#   statement {
#     sid       = "LosLogs"
#     actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
#     resources = ["arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.name}-api:*"]
#   }
# }
#
# resource "aws_iam_role_policy" "api" {
#   name   = "${local.name}-api"
#   role   = aws_iam_role.api.id
#   policy = data.aws_iam_policy_document.api.json
# }
#
# La notificadora tendría su propio rol con LA MISMA estructura y una sola
# statement, la de los logs: no lee, no escribe y no publica.
