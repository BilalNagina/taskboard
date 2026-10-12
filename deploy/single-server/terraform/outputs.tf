output "static_ip" {
  description = "Point your domain's A record here."
  value       = aws_lightsail_static_ip.app.ip_address
}

output "ssh_command" {
  value = "ssh -i ${trimsuffix(pathexpand(var.ssh_public_key_path), ".pub")} ubuntu@${aws_lightsail_static_ip.app.ip_address}"
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "backup_access_key_id" {
  value = aws_iam_access_key.backup.id
}

output "backup_secret_access_key" {
  value     = aws_iam_access_key.backup.secret
  sensitive = true
}

output "attachments_bucket" {
  value = aws_s3_bucket.attachments.bucket
}

output "app_access_key_id" {
  description = "S3_ACCESS_KEY_ID and SMTP_USER in .env."
  value       = aws_iam_access_key.app.id
}

output "app_secret_access_key" {
  description = "S3_SECRET_ACCESS_KEY in .env."
  value       = aws_iam_access_key.app.secret
  sensitive   = true
}

output "smtp_host" {
  value = "email-smtp.${var.region}.amazonaws.com"
}

output "smtp_password" {
  description = "SMTP_PASS in .env."
  value       = aws_iam_access_key.app.ses_smtp_password_v4
  sensitive   = true
}

output "dkim_records" {
  description = "CNAME records to add to DNS so SES can verify the mail domain."
  value = var.mail_domain == "" ? [] : [
    for token in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : {
      type  = "CNAME"
      name  = "${token}._domainkey.${var.mail_domain}"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}
