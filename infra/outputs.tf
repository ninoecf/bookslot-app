output "api_invoke_url" {
  description = "URL pública de la API. Va a config.js y a los scripts de prueba"
  value       = aws_apigatewayv2_api.bookslot_api.api_endpoint
}

output "web_url" {
  description = "La aplicación. Es lo que se abre en el navegador"
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_bucket_name" {
  description = "Destino del aws s3 sync al publicar la interfaz"
  value       = aws_s3_bucket.web.id
}

output "cloudfront_distribution_id" {
  description = "Necesario para invalidar la caché tras subir la interfaz"
  value       = aws_cloudfront_distribution.web.id
}

output "cognito_user_pool_id" {
  description = "Grupo de usuarios contra el que se registra y accede el navegador"
  value       = aws_cognito_user_pool.bookslot.id
}

output "cognito_client_id" {
  description = "Cliente de Cognito. No es un secreto: viaja en el navegador dentro de config.js"
  value       = aws_cognito_user_pool_client.web.id
}

output "table_name" {
  description = "Nombre de la tabla de DynamoDB desplegada"
  value       = aws_dynamodb_table.bookslot.name
}

# Los crea Lambda en la primera invocación; aquí solo se componen los nombres.
output "api_log_group_name" {
  description = "Donde mirar cuando una petición devuelve 500"
  value       = "/aws/lambda/${aws_lambda_function.api.function_name}"
}

output "notifier_log_group_name" {
  description = "Donde queda el correo simulado. Es la evidencia del aviso"
  value       = "/aws/lambda/${aws_lambda_function.notifier.function_name}"
}
