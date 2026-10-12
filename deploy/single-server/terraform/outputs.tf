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
