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
