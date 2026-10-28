variable "tenancy_ocid" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "amount" {
  description = "Monthly amount in the account's billing currency"
  type        = number
}

variable "alert_email" {
  type = string
}
