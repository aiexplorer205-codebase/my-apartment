variable "compartment_id" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "vcn_cidr" {
  type = string
}

variable "subnet_cidr" {
  type = string
}

variable "ssh_allowed_cidrs" {
  type    = list(string)
  default = []
}
