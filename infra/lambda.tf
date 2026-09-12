# --- Funciones Lambda -------------------------------------------------------
# El rol de cada función está definido en iam.tf

data "archive_file" "api" {
  type        = "zip"
  source_file = "${path.module}/../functions/api-functions/index.mjs"
  output_path = "${path.module}/build/api.zip"
}

data "archive_file" "notifier" {
  type        = "zip"
  source_file = "${path.module}/../functions/notification-functions/index.mjs"
  output_path = "${path.module}/build/notifier.zip"
}

resource "aws_lambda_function" "api" {
  filename         = data.archive_file.api.output_path
  function_name    = "${local.name}-api"
  role             = aws_iam_role.api.arn
  source_code_hash = data.archive_file.api.output_base64sha256
  runtime          = "nodejs24.x"
  handler          = "index.handler"

  timeout       = 10
  memory_size   = 256
  architectures = ["arm64"]

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.bookslot.name
      TOPIC_ARN  = aws_sns_topic.events.arn
    }
  }
}

resource "aws_lambda_function" "notifier" {
  filename         = data.archive_file.notifier.output_path
  function_name    = "${local.name}-notifier"
  role             = aws_iam_role.notifier.arn
  source_code_hash = data.archive_file.notifier.output_base64sha256
  runtime          = "nodejs24.x"
  handler          = "index.handler"

  timeout       = 5
  memory_size   = 128
  architectures = ["arm64"]
}
