# Credentials come from ~/.oci/config (the profile you paste from the console
# "Add API key" dialog). No secrets live in this repo.
provider "oci" {
  region              = var.region
  config_file_profile = var.oci_config_profile
}
