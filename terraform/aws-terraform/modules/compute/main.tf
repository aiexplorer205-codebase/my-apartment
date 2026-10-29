locals {
  hostname = "${var.name_prefix}-vm"

  # t4g = Graviton (arm64), everything else here is x86_64
  is_arm   = startswith(var.instance_type, "t4g")
  arch_ami = local.is_arm ? "arm64" : "amd64"
  arch_api = local.is_arm ? "arm64" : "x86_64"

  # Queue option: pg-boss needs nothing extra. Redis turns on the "redis" Compose profile.
  compose_profiles = var.queue_backend == "redis" ? "redis" : ""
  extra_env        = var.queue_backend == "redis" ? "REDIS_URL=redis://redis:6379" : ""
}

# Latest official Ubuntu 24.04 LTS (Canonical account), SSM agent is preinstalled
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${local.arch_ami}-server-*"]
  }

  filter {
    name   = "architecture"
    values = [local.arch_api]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "this" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  iam_instance_profile        = var.instance_profile_name
  associate_public_ip_address = true
  monitoring                  = false # detailed monitoring costs extra

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname = local.hostname
    compose = base64gzip(templatefile("${path.module}/files/docker-compose.yml.tftpl", {
      app_image       = var.app_image
      cloudflared_tag = var.cloudflared_tag
    }))
    backup_sh = base64gzip(templatefile("${path.module}/files/backup.sh.tftpl", {
      bucket = var.backup_bucket
      region = var.region
    }))
    init_env = base64gzip(templatefile("${path.module}/files/init-env.sh.tftpl", {
      queue_backend    = var.queue_backend
      compose_profiles = local.compose_profiles
      extra_env        = local.extra_env
      age_public_key   = var.age_public_key
    }))
  })
  user_data_replace_on_change = false

  # IMDSv2 only
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  # standard = throttle when credits run out instead of billing surplus CPU credits
  credit_specification {
    cpu_credits = "standard"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true

    tags = {
      Name = "${local.hostname}-root"
    }
  }

  tags = {
    Name = local.hostname
  }

  lifecycle {
    # A new AMI release or an edited cloud-init must never replace a running server (data loss).
    ignore_changes = [ami, user_data]
  }
}
