# --- Cognito ----------------------------------------------------------------
# Custodia las contraseñas y emite el token. El navegador habla con él
# directamente: la API no necesita ningún permiso de Cognito.

resource "aws_cognito_user_pool" "bookslot" {
  name                     = local.name
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = false
  }

  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name}-web"
  user_pool_id = aws_cognito_user_pool.bookslot.id

  # Cliente público: un secreto que viaja en el navegador no es un secreto.
  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 1

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # La misma respuesta exista el usuario o no: distinguirlo regalaría la lista
  # de correos registrados.
  prevent_user_existence_errors = "ENABLED"
}

# --- Grupo de administradores -----------------------------------------------
# La Lambda lo lee de la claim cognito:groups. Terraform no crea ningún usuario
# dentro: una contraseña no debe acabar en el estado.

resource "aws_cognito_user_group" "admins" {
  name         = "admins"
  user_pool_id = aws_cognito_user_pool.bookslot.id
  description  = "Puede crear recursos y franjas"
  precedence   = 1
}
