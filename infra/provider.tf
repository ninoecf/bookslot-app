terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.21"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }

  # El bucket lo crea scripts/create-bucket-4-tfstate.sh. Su nombre lleva el id
  # de cuenta, que no se puede interpolar dentro de un bloque backend, así que
  # se pasa en el init:
  #   terraform init -backend-config="bucket=$BUCKET"
  backend "s3" {
    key          = "bookslot/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      Owner       = var.owner
      ManagedBy   = "terraform"
    }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  name = "${var.project_name}-${var.environment}"
}
