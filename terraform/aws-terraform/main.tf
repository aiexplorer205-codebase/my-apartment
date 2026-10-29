module "network" {
  source = "./modules/network"

  name_prefix = var.name_prefix
  vpc_cidr    = var.vpc_cidr
  subnet_cidr = var.subnet_cidr
  az_index    = var.az_index
}

module "storage" {
  source = "./modules/storage"

  name_prefix    = var.name_prefix
  region         = var.region
  retention_days = var.backup_retention_days
}

module "iam" {
  source = "./modules/iam"

  name_prefix = var.name_prefix
  bucket_arn  = module.storage.bucket_arn
}

module "compute" {
  source = "./modules/compute"

  name_prefix           = var.name_prefix
  region                = var.region
  instance_type         = var.instance_type
  root_volume_gb        = var.root_volume_gb
  subnet_id             = module.network.subnet_id
  security_group_id     = module.network.security_group_id
  instance_profile_name = module.iam.instance_profile_name
  queue_backend         = var.queue_backend
  app_image             = var.app_image
  cloudflared_tag       = var.cloudflared_tag
  age_public_key        = var.age_public_key
  backup_bucket         = module.storage.bucket_name
}

module "budgets" {
  source = "./modules/budgets"

  name_prefix              = var.name_prefix
  alert_email              = var.alert_email
  ceiling_usd              = var.ceiling_usd
  alert_thresholds_usd     = var.alert_thresholds_usd
  cash_alert_usd           = var.cash_alert_usd
  enable_anomaly_detection = var.enable_anomaly_detection
}

module "ci_deploy" {
  count  = var.enable_ci_deploy ? 1 : 0
  source = "./modules/ci_deploy"

  name_prefix          = var.name_prefix
  region               = var.region
  instance_id          = module.compute.instance_id
  github_repo          = var.github_repo
  github_branch        = var.github_branch
  create_oidc_provider = var.create_github_oidc_provider
}
