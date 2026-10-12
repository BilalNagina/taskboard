# ---------------------------------------------------------------- server

resource "aws_lightsail_key_pair" "deploy" {
  name       = "taskboard-deploy"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "aws_lightsail_instance" "app" {
  name              = "taskboard"
  availability_zone = "${var.region}a"
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  key_pair_name     = aws_lightsail_key_pair.deploy.name

  # Lightsail prepends its own /bin/sh launch script to user data, so a bash shebang is
  # ignored. Write the script to disk and run it with bash explicitly.
  user_data = <<-EOT
    cat > /root/bootstrap-server.sh <<'BOOTSTRAP'
    ${file("${path.module}/../scripts/bootstrap-server.sh")}
    BOOTSTRAP
    bash /root/bootstrap-server.sh > /var/log/taskboard-bootstrap.log 2>&1
  EOT
}

# A static IP survives instance replacement, so the DNS record never has to change.
resource "aws_lightsail_static_ip" "app" {
  name = "taskboard-ip"
}

resource "aws_lightsail_static_ip_attachment" "app" {
  static_ip_name = aws_lightsail_static_ip.app.name
  instance_name  = aws_lightsail_instance.app.name

  # The instance name stays the same when it's replaced, so without this the
  # attachment would not be recreated and the IP would be left detached.
  lifecycle {
    replace_triggered_by = [aws_lightsail_instance.app]
  }
}

resource "aws_lightsail_instance_public_ports" "app" {
  instance_name = aws_lightsail_instance.app.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = var.ssh_cidrs
  }

  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
  }

  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
  }
}

# ---------------------------------------------------------------- backups

resource "aws_s3_bucket" "backups" {
  bucket = var.backup_bucket_name
  # Lets `terraform destroy` remove the bucket with backups still in it (demo teardown).
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"

    filter {
      prefix = "postgres/"
    }

    expiration {
      days = var.backup_retention_days
    }
  }
}

# Lightsail instances can't take IAM roles, so backups use a dedicated user that can
# only read and write the backup prefix of this one bucket.
resource "aws_iam_user" "backup" {
  name = "taskboard-backup"
}

resource "aws_iam_user_policy" "backup" {
  name = "taskboard-backup-bucket"
  user = aws_iam_user.backup.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.backups.arn}/postgres/*"
      },
      {
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.backups.arn
        Condition = { StringLike = { "s3:prefix" = ["postgres/*"] } }
      },
    ]
  })
}

resource "aws_iam_access_key" "backup" {
  user = aws_iam_user.backup.name
}

# ---------------------------------------------------------------- cost guardrail

resource "aws_budgets_budget" "monthly" {
  name         = "taskboard-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
