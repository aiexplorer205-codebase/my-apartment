variable "name_prefix" {
  type = string
}

variable "alert_email" {
  type = string
}

variable "ceiling_usd" {
  type = number
}

variable "alert_thresholds_usd" {
  type = list(number)

  validation {
    condition     = length(var.alert_thresholds_usd) <= 4
    error_message = "A budget allows 5 notifications in total: at most 4 thresholds plus the ceiling."
  }
}

variable "cash_alert_usd" {
  type = number
}

variable "enable_anomaly_detection" {
  type    = bool
  default = false
}
