provider "aws" {
  region  = var.region
  profile = var.aws_profile # null = default credential chain (env vars, SSO, etc.)

  default_tags {
    tags = {
      Project   = var.name_prefix
      ManagedBy = "terraform"
    }
  }
}
