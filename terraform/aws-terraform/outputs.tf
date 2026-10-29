output "instance_id" {
  value = module.compute.instance_id
}

output "public_ip" {
  description = "Public IPv4 (billed at about $3.65/month; nothing listens on it)."
  value       = module.compute.public_ip
}

output "ssm_session_command" {
  description = "Shell access with no SSH and no open ports"
  value       = "aws ssm start-session --target ${module.compute.instance_id} --region ${var.region}${var.aws_profile == null ? "" : " --profile ${var.aws_profile}"}"
}

output "backup_bucket" {
  value = module.storage.bucket_name
}

output "ci_deploy_role_arn" {
  description = "Put this in GitHub as secret AWS_DEPLOY_ROLE_ARN"
  value       = try(module.ci_deploy[0].role_arn, null)
}

output "queue_backend" {
  value = var.queue_backend
}
