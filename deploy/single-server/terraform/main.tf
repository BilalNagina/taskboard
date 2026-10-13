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

# CIDRs are spelled out on every rule: left unset, the provider reads back the defaults
# and plans a replacement of the whole port set on every run.
resource "aws_lightsail_instance_public_ports" "app" {
  instance_name = aws_lightsail_instance.app.name

  port_info {
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidrs      = var.ssh_cidrs
    ipv6_cidrs = []
  }

  port_info {
    protocol   = "tcp"
    from_port  = 80
    to_port    = 80
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  port_info {
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
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

# ---------------------------------------------------------------- attachments

# Files users attach to tasks. Private: the API streams uploads and downloads after
# checking ownership, so the bucket never needs public access or presigned URLs.
resource "aws_s3_bucket" "attachments" {
  bucket        = var.attachments_bucket_name
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "attachments" {
  bucket                  = aws_s3_bucket.attachments.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning is the backup for files: a deleted or overwritten attachment can be
# recovered for 30 days, which also covers restoring an older database dump.
resource "aws_s3_bucket_versioning" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "attachments" {
  bucket     = aws_s3_bucket.attachments.id
  depends_on = [aws_s3_bucket_versioning.attachments]

  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.attachment_version_retention_days
    }

    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# ---------------------------------------------------------------- email (Amazon SES)

# Domain identity with Easy DKIM. Add the three CNAME records from the `dkim_records`
# output to DNS; SES verifies the domain once they resolve.
resource "aws_sesv2_email_identity" "domain" {
  count          = var.mail_domain == "" ? 0 : 1
  email_identity = var.mail_domain
}

# New SES accounts are in the sandbox and can only send to verified addresses.
# Each address listed here gets a verification email with a link to click.
resource "aws_sesv2_email_identity" "recipients" {
  for_each       = toset(var.mail_verified_recipients)
  email_identity = each.value
}

# ---------------------------------------------------------------- app credentials

# What the API and worker run as: read/write/delete attachments in one bucket, and
# send email from the app's domain only.
resource "aws_iam_user" "app" {
  name = "taskboard-app"
}

resource "aws_iam_user_policy" "app" {
  name = "taskboard-app"
  user = aws_iam_user.app.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.attachments.arn}/attachments/*"
      }],
      var.mail_domain == "" ? [] : [{
        Effect    = "Allow"
        Action    = "ses:SendRawEmail"
        Resource  = "*"
        Condition = { StringLike = { "ses:FromAddress" = "*@${var.mail_domain}" } }
      }],
    )
  })
}

# Also the SES SMTP credentials: the username is the key id, and the provider derives
# the SMTP password from the secret.
resource "aws_iam_access_key" "app" {
  user = aws_iam_user.app.name
}
