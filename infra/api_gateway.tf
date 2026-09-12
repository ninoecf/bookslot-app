# --- API Gateway (HTTP API) -------------------------------------------------

resource "aws_apigatewayv2_api" "bookslot_api" {
  name          = "${local.name}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://${aws_cloudfront_distribution.web.domain_name}"]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["authorization", "content-type", "idempotency-key"]
    max_age       = 3600
  }
}

# --- Authorizer JWT ---------------------------------------------------------

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.bookslot_api.id
  name             = "${local.name}-jwt"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web.id]
    issuer   = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.bookslot.id}"
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.bookslot_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 9000
}

# --- Rutas -------------------------------------------------

locals {
  rutas_publicas = [
    "POST /register",
    "GET /resources",
    "GET /resources/{resourceId}",
    "GET /slots",
  ]

  rutas_privadas = [
    "POST /reservations",
    "GET /reservations",
    "DELETE /reservations/{slotId}",
    "POST /admin/resources",
    "POST /admin/slots",
  ]
}

resource "aws_apigatewayv2_route" "publicas" {
  for_each = toset(local.rutas_publicas)

  api_id    = aws_apigatewayv2_api.bookslot_api.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "privadas" {
  for_each = toset(local.rutas_privadas)

  api_id             = aws_apigatewayv2_api.bookslot_api.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.bookslot_api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 200
    throttling_rate_limit  = 100

    detailed_metrics_enabled = false
  }
}

# --- Permiso para que API Gateway pueda invocar la Lambda -------------------

resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.bookslot_api.execution_arn}/*/*"
}
