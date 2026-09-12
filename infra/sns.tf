# --- Avisos de reserva ------------------------------------------------------
# La API publica aquí y ahí se acaba su responsabilidad. Quien lo consume es la
# notificadora, que simula el envío del correo escribiéndolo en su log.

resource "aws_sns_topic" "events" {
  name = "${local.name}-events"
}

resource "aws_sns_topic_subscription" "notifier" {
  topic_arn = aws_sns_topic.events.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.notifier.arn
}

resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notifier.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.events.arn
}

# --- Alarmas ----------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
