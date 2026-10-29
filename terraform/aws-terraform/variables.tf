variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "aws_profile" {
  description = "AWS CLI profile name (for example your SSO profile). null uses the default credential chain."
  type        = string
  default     = null
}

variable "name_prefix" {
  type    = string
  default = "myapartment"
}

# ---------------- compute ----------------
variable "instance_type" {
  description = "t4g.small (ARM, cheapest) or t3.small (x86). Guarded list, see the compute module."
  type        = string
  default     = "t4g.small"
}

variable "root_volume_gb" {
  type    = number
  default = 30
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}

variable "az_index" {
  description = "Which availability zone to use (0, 1 or 2). Change if the instance type is out of capacity."
  type        = number
  default     = 0
}

# ---------------- app stack ----------------
variable "queue_backend" {
  description = "Job queue backend: pgboss (no Redis, saves RAM) or redis (adds a Redis container). Sets first-boot defaults only. After launch edit /opt/myapartment/.env."
  type        = string
  default     = "pgboss"

  validation {
    condition     = contains(["pgboss", "redis"], var.queue_backend)
    error_message = "queue_backend must be pgboss or redis."
  }
}

variable "app_image" {
  description = "Image repository without tag, e.g. ghcr.io/youruser/myapartment"
  type        = string
  default     = "ghcr.io/YOUR_GH_USER/myapartment"
}

variable "cloudflared_tag" {
  description = "cloudflared image tag. Pin a specific version once it works."
  type        = string
  default     = "latest"
}

variable "age_public_key" {
  description = "age PUBLIC key (starts with age1...) used to encrypt DB backups. Backups refuse to run without it."
  type        = string
  default     = ""
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

# ---------------- budgets and alerts ----------------
variable "alert_email" {
  description = "Email for all cost alerts"
  type        = string
}

variable "ceiling_usd" {
  description = "Your approved monthly ceiling (USD)"
  type        = number
  default     = 25
}

variable "alert_thresholds_usd" {
  description = "Extra absolute alert levels on the gross-usage budget (max 4 values)"
  type        = list(number)
  default     = [5, 10, 20]
}

variable "cash_alert_usd" {
  description = "Alert when real out-of-pocket spend (credits applied) exceeds this"
  type        = number
  default     = 1
}

variable "enable_anomaly_detection" {
  description = "Cost Anomaly Detection (free). Turn on after you have opened Cost Explorer once."
  type        = bool
  default     = false
}

# ---------------- optional CI deploy over SSM ----------------
variable "enable_ci_deploy" {
  type    = bool
  default = false
}

variable "github_repo" {
  description = "owner/repo allowed to deploy (needed when enable_ci_deploy = true)"
  type        = string
  default     = ""
}

variable "github_branch" {
  type    = string
  default = "main"
}

variable "create_github_oidc_provider" {
  description = "Set false if your account already has the GitHub OIDC provider"
  type        = bool
  default     = true
}
