# Budgets are created at the tenancy root. Any real spend above `amount` emails you.
resource "oci_budget_budget" "this" {
  compartment_id = var.tenancy_ocid
  display_name   = "${var.name_prefix}-zero-cost-guard"
  description    = "Alerts if anything starts costing money"
  amount         = var.amount
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [var.tenancy_ocid]
}

resource "oci_budget_alert_rule" "actual_100" {
  budget_id      = oci_budget_budget.this.id
  display_name   = "${var.name_prefix}-actual-100pct"
  type           = "ACTUAL"
  threshold      = 100
  threshold_type = "PERCENTAGE"
  recipients     = var.alert_email
  message        = "Oracle spend reached the zero-cost guard. Open Cost Analysis and look for orphaned boot volumes, reserved IPs or oversized shapes."
}
