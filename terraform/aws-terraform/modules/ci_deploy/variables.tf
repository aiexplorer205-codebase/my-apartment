variable "name_prefix" {
  type = string
}

variable "region" {
  type = string
}

variable "instance_id" {
  type = string
}

variable "github_repo" {
  description = "owner/repo"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repo))
    error_message = "github_repo must look like owner/repo."
  }
}

variable "github_branch" {
  type    = string
  default = "main"
}

variable "create_oidc_provider" {
  type    = bool
  default = true
}
