variable "name_prefix" {
  type = string
}

variable "region" {
  type = string
}

# Cost guard: only small, Free Plan eligible sizes. Edit this list on purpose if you really need more.
variable "instance_type" {
  type    = string
  default = "t4g.small"

  validation {
    condition     = contains(["t4g.micro", "t4g.small", "t3.micro", "t3.small"], var.instance_type)
    error_message = "Allowed: t4g.micro, t4g.small, t3.micro, t3.small. Edit the list in modules/compute/variables.tf if you accept a bigger bill."
  }
}

variable "root_volume_gb" {
  type    = number
  default = 30

  validation {
    condition     = var.root_volume_gb >= 20 && var.root_volume_gb <= 60
    error_message = "root_volume_gb must be between 20 and 60."
  }
}

variable "subnet_id" {
  type = string
}

variable "security_group_id" {
  type = string
}

variable "instance_profile_name" {
  type = string
}

variable "queue_backend" {
  type    = string
  default = "pgboss"

  validation {
    condition     = contains(["pgboss", "redis"], var.queue_backend)
    error_message = "queue_backend must be pgboss or redis."
  }
}

variable "app_image" {
  type = string
}

variable "cloudflared_tag" {
  type    = string
  default = "latest"
}

variable "age_public_key" {
  type    = string
  default = ""
}

variable "backup_bucket" {
  type = string
}
