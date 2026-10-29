output "instance_profile_name" {
  value = aws_iam_instance_profile.vm.name
}

output "role_arn" {
  value = aws_iam_role.vm.arn
}
