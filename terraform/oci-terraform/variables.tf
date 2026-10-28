variable "region" {
  description = "Your HOME region. Always Free resources must live here."
  type        = string
  default     = "ap-hyderabad-1"
}

variable "oci_config_profile" {
  description = "Profile name in ~/.oci/config"
  type        = string
  default     = "DEFAULT"
}

variable "tenancy_ocid" {
  description = "Tenancy OCID (the tenancy= line in ~/.oci/config)"
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment for all resources. Leave null to use the tenancy root."
  type        = string
  default     = null
}

variable "name_prefix" {
  description = "Prefix for resource names. The VM hostname becomes <prefix>-vm."
  type        = string
  default     = "myapartment"
}

variable "vcn_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.0.1.0/24"
}

variable "ssh_public_key_path" {
  description = "Path to your SSH PUBLIC key"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "ssh_allowed_cidrs" {
  description = "CIDRs allowed to reach port 22. Keep [] when using Tailscale (no inbound ports at all)."
  type        = list(string)
  default     = []
}

variable "tailscale_auth_key" {
  description = "Single-use, short-expiry Tailscale auth key. Empty = skip Tailscale (then set ssh_allowed_cidrs)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "os_version" {
  description = "Ubuntu version (aarch64 image)"
  type        = string
  default     = "24.04"
}

# ---- Free-tier sizing (guard rails live in the compute module) ----
variable "ocpus" {
  type    = number
  default = 2
}

variable "memory_gbs" {
  type    = number
  default = 12
}

variable "boot_volume_gbs" {
  description = "Boot volume size. Minimum 47, free block storage is 200 GB total."
  type        = number
  default     = 50
}

variable "availability_domain_index" {
  description = "0 = first availability domain. Try 1 or 2 if your region has several and one is out of capacity."
  type        = number
  default     = 0
}

# ---- Budget alert ----
variable "create_budget" {
  type    = bool
  default = true
}

variable "budget_amount" {
  description = "Monthly budget in YOUR BILLING CURRENCY. Use about 1 for USD, about 100 for INR."
  type        = number
  default     = 1
}

variable "alert_email" {
  description = "Email for budget alerts. Empty = no budget created."
  type        = string
  default     = ""
}
