# --- Bucket privado de la interfaz ------------------------------------------
# Sin alojamiento web estático de S3 y sin ninguna política que abra el bucket:
# el único que puede leerlo es CloudFront, con OAC.

resource "aws_s3_bucket" "web" {
  # El nombre de un bucket es único en todo AWS, de ahí el id de cuenta.
  bucket        = "${local.name}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Acceso de CloudFront al bucket (OAC) -----------------------------------
# CloudFront firma cada petición al origen con SigV4 y la política del bucket
# solo acepta las que vienen de esta distribución.

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "SoloEstaDistribucion"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    # Sin esta condición, cualquier distribución de CloudFront del mundo podría
    # poner este bucket como origen.
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json

  # El bloqueo de acceso público tiene que estar puesto antes que la política.
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# --- Distribución de CloudFront ---------------------------------------------

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  is_ipv6_enabled     = true

  # PriceClass_100 es Europa y Norteamérica; las demás clases cobran más del
  # doble por GB servido.
  price_class = "PriceClass_100"

  origin {
    origin_id                = "s3-web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # El certificado del dominio *.cloudfront.net. Uno propio exigiría ACM en
    # us-east-1 y comprar el dominio; el enunciado pide HTTPS, no un dominio.
    cloudfront_default_certificate = true
  }
}

# Política de caché gestionada por AWS, buscada por nombre en lugar de pegar su
# UUID en el código.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}
