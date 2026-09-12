# --- Tabla única con un índice global ---------------------------------------
# Aquí vive todo el estado del sistema, y aquí se decide la plaza.

resource "aws_dynamodb_table" "bookslot" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  # Solo se declaran los atributos que son clave; el resto no tiene esquema.
  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # Da la vuelta a la tabla para las tres consultas que no van por la clave
  # principal: listar recursos, franjas de un recurso y reservas de un usuario.
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # El requisito de backups: 35 días con granularidad de segundo.
  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  # Solo actúa sobre los items de idempotencia, que llevan el atributo ttl.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  deletion_protection_enabled = false
}
