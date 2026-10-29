locals {
  hostname             = "${var.name_prefix}-vm"
  availability_domain  = try(data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name, "")
  ubuntu_arm_image_id  = try(data.oci_core_images.ubuntu_arm.images[0].id, "")
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = var.os_version
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_id
  availability_domain = local.availability_domain
  display_name        = local.hostname
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = local.ubuntu_arm_image_id
    boot_volume_size_in_gbs = var.boot_volume_gbs
  }

  create_vnic_details {
    subnet_id        = var.subnet_id
    assign_public_ip = true # ephemeral IP; a reserved IP would be a cost trap
    hostname_label   = local.hostname
    display_name     = "${local.hostname}-vnic"
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      hostname           = local.hostname
      ssh_public_key     = var.ssh_public_key
      tailscale_auth_key = var.tailscale_auth_key
    }))
  }

  # Delete the boot volume with the instance so no orphan keeps billing
  preserve_boot_volume = false

  lifecycle {
    # A newer Ubuntu image or an edited cloud-init must NOT replace a running VM (data loss).
    ignore_changes = [
      source_details[0].source_id,
      metadata["user_data"],
    ]

    precondition {
      condition     = try(length(data.oci_identity_availability_domains.ads.availability_domains) > 0, false)
      error_message = "No availability domains were returned. Verify tenancy_ocid is the tenancy OCID from ~/.oci/config and that OCI credentials are valid."
    }

    precondition {
      condition     = try(length(data.oci_core_images.ubuntu_arm.images) > 0, false)
      error_message = "No Ubuntu aarch64 image found for this version and region. Try os_version = \"22.04\"."
    }
  }
}
