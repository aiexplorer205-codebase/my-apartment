output "instance_id" {
  value = oci_core_instance.this.id
}

output "public_ip" {
  value = oci_core_instance.this.public_ip
}

output "hostname" {
  value = local.hostname
}
