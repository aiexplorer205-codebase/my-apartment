locals {
  compartment_id = coalesce(var.compartment_ocid, var.tenancy_ocid)
  ssh_public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
}

module "network" {
  source = "./modules/network"

  compartment_id    = local.compartment_id
  name_prefix       = var.name_prefix
  vcn_cidr          = var.vcn_cidr
  subnet_cidr       = var.subnet_cidr
  ssh_allowed_cidrs = var.ssh_allowed_cidrs
}

module "compute" {
  source = "./modules/compute"

  tenancy_ocid              = var.tenancy_ocid
  compartment_id            = local.compartment_id
  name_prefix               = var.name_prefix
  subnet_id                 = module.network.subnet_id
  availability_domain_index = var.availability_domain_index
  os_version                = var.os_version
  ocpus                     = var.ocpus
  memory_gbs                = var.memory_gbs
  boot_volume_gbs           = var.boot_volume_gbs
  ssh_public_key            = local.ssh_public_key
  tailscale_auth_key        = var.tailscale_auth_key
}

module "budget" {
  count  = var.create_budget && var.alert_email != "" ? 1 : 0
  source = "./modules/budget"

  tenancy_ocid = var.tenancy_ocid
  name_prefix  = var.name_prefix
  amount       = var.budget_amount
  alert_email  = var.alert_email
}
