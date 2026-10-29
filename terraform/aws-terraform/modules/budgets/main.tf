locals {
  thresholds = distinct(concat(var.alert_thresholds_usd, [var.ceiling_usd]))
}

# BUDGET 1: GROSS usage, credits excluded.
# Shows your real burn rate even while credits are hiding the bill.
# Alerts at each threshold and at your approved ceiling.
resource "aws_budgets_budget" "gross" {
  name         = "${var.name_prefix}-gross-usage"
  budget_type  = "COST"
  limit_amount = tostring(var.ceiling_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = toset(local.thresholds)

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "ABSOLUTE_VALUE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}

# BUDGET 2: CASH spend, credits applied.
# Fires when you start paying real money out of pocket.
resource "aws_budgets_budget" "cash" {
  name         = "${var.name_prefix}-cash-spend"
  budget_type  = "COST"
  limit_amount = tostring(var.cash_alert_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = true
    include_refund = true
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# Optional: Cost Anomaly Detection (free). Needs Cost Explorer enabled once in the console.
resource "aws_ce_anomaly_monitor" "services" {
  count = var.enable_anomaly_detection ? 1 : 0

  name              = "${var.name_prefix}-service-monitor"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "daily" {
  count = var.enable_anomaly_detection ? 1 : 0

  name             = "${var.name_prefix}-anomaly-daily"
  frequency        = "DAILY"
  monitor_arn_list = [aws_ce_anomaly_monitor.services[0].arn]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = ["5"]
    }
  }
}
