variable "tenancy_ocid" {
  type = string
}

variable "compartment_id" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "availability_domain_index" {
  type    = number
  default = 0
}

variable "os_version" {
  type    = string
  default = "24.04"
}

# ---- Free-tier guard rails: plan fails instead of silently creating billable resources ----
variable "ocpus" {
  type    = number
  default = 2

  validation {
    condition     = var.ocpus >= 1 && var.ocpus <= 2
    error_message = "Always Free Ampere A1 allows 2 OCPU in total (limit reduced in 2026). Raise this only if you accept charges."
  }
}

variable "memory_gbs" {
  type    = number
  default = 12

  validation {
    condition     = var.memory_gbs >= 1 && var.memory_gbs <= 12
    error_message = "Always Free Ampere A1 allows 12 GB RAM in total. Raise this only if you accept charges."
  }
}

variable "boot_volume_gbs" {
  type    = number
  default = 50

  validation {
    condition     = var.boot_volume_gbs >= 47 && var.boot_volume_gbs <= 200
    error_message = "Boot volume must be 47 to 200 GB (200 GB is the total free block storage)."
  }
}

variable "ssh_public_key" {
  type = string
}

variable "tailscale_auth_key" {
  type      = string
  default   = ""
  sensitive = true
}
