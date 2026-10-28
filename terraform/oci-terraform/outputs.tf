output "instance_id" {
  value = module.compute.instance_id
}

output "public_ip" {
  description = "Ephemeral public IP (needed for outbound traffic and the tunnel; nothing listens on it)."
  value       = module.compute.public_ip
}

output "hostname" {
  value = module.compute.hostname
}

output "connect" {
  value = length(var.ssh_allowed_cidrs) > 0 ? "ssh deploy@${module.compute.public_ip}" : "ssh deploy@${module.compute.hostname}   (over Tailscale, check: tailscale status)"
}
