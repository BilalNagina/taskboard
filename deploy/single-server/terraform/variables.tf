variable "region" {
  description = "AWS region for the server and the backup bucket."
  type        = string
}

variable "bundle_id" {
  description = "Lightsail plan. small_3_0 = 2 GB RAM, enough for PostgreSQL + API + NGINX."
  type        = string
  default     = "small_3_0"
}

variable "blueprint_id" {
  description = "Lightsail OS image."
  type        = string
  default     = "ubuntu_24_04"
}

variable "ssh_public_key_path" {
  description = "Public half of the SSH key used for deploys."
  type        = string
  default     = "~/.ssh/taskboard.pub"
}

variable "ssh_cidrs" {
  description = <<-EOT
    Who may reach SSH. GitHub-hosted runners use changing IPs, so automated deploys
    need this open; password login is disabled and fail2ban is on. Narrow it if you
    deploy from a fixed address only.
  EOT
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "backup_bucket_name" {
  description = "Globally unique S3 bucket name for database backups."
  type        = string
}

variable "backup_retention_days" {
  description = "How long backups are kept in S3."
  type        = number
  default     = 14
}

variable "budget_limit_usd" {
  description = "Monthly AWS budget. Alerts at 80% actual and 100% forecast."
  type        = number
  default     = 20
}

variable "budget_email" {
  description = "Where budget alerts are sent."
  type        = string
}

variable "attachments_bucket_name" {
  description = "Globally unique S3 bucket name for task attachments."
  type        = string
}

variable "attachment_version_retention_days" {
  description = "How long deleted or replaced attachment versions are kept (file backup window)."
  type        = number
  default     = 30
}

variable "mail_domain" {
  description = "Domain reminder emails are sent from, verified in SES with DKIM (e.g. taskboard.example.com). Empty disables email."
  type        = string
  default     = ""
}

variable "mail_verified_recipients" {
  description = "Addresses to verify in SES. Needed while the account is in the SES sandbox, which only delivers to verified addresses."
  type        = list(string)
  default     = []
}
