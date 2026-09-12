variable "aws_region" {
  description = "Región de AWS donde se despliega la infraestructura"
  type        = string
  default     = "eu-west-1"
}

variable "aws_profile" {
  description = "Perfil de AWS CLI a usar (ver aws configure list-profiles). Déjalo como null para usar la cadena de credenciales por defecto."
  type        = string
  default     = null
}

variable "project_name" {
  description = "Nombre base usado para nombrar los recursos"
  type        = string
  default     = "bookslot"
}

variable "environment" {
  description = "Entorno desplegado. Entra en el tag Environment y en el nombre de los recursos"
  type        = string
  default     = "dev"
}

variable "owner" {
  description = "Valor del tag Owner que exige el enunciado"
  type        = string
  default     = "bookslot"
}

variable "alert_email" {
  description = "Buzón que recibe las alarmas de CloudWatch y los avisos de presupuesto. Sin valor por defecto: se pone en terraform.tfvars, que no va al repositorio"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Techo mensual de AWS Budgets, en dólares"
  type        = number
  default     = 30
}
