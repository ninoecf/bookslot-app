# --- Roles de ejecución de las Lambdas --------------------------------------
# Un rol por función, con lo justo que necesita cada una. Ninguno adjunta
# AWSLambdaBasicExecutionRole, que concede logs:* sobre *.

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# --- La API -----------------------------------------------------------------

resource "aws_iam_role" "api" {
  name               = "${local.name}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "api" {

  statement {
    sid = "LaTabla"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
    ]

    # Una política sobre la tabla no cubre sus índices: el GSI va aparte.
    resources = [
      aws_dynamodb_table.bookslot.arn,
      "${aws_dynamodb_table.bookslot.arn}/index/GSI1",
    ]
  }

  # Publish y nada más: la suscripción de la notificadora la crea Terraform,
  # no el código, así que no hace falta sns:Subscribe.
  statement {
    sid       = "ElAviso"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.events.arn]
  }

  # Tres acciones sobre UN grupo de logs, el suyo.
  statement {
    sid       = "LosLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.name}-api:*"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${local.name}-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# --- La notificadora --------------------------------------------------------
# No lee, no escribe y no publica: la invoca SNS y escribe en su log.

resource "aws_iam_role" "notifier" {
  name               = "${local.name}-notifier"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "notifier" {
  statement {
    sid       = "LosLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.name}-notifier:*"]
  }
}

resource "aws_iam_role_policy" "notifier" {
  name   = "${local.name}-notifier"
  role   = aws_iam_role.notifier.id
  policy = data.aws_iam_policy_document.notifier.json
}
