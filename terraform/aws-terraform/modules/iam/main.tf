data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vm" {
  name               = "${var.name_prefix}-vm-role"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

# Session Manager, Run Command and patching, with no SSH
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.vm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "backup" {
  statement {
    sid       = "WriteAndReadBackupObjects"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${var.bucket_arn}/*"]
  }

  statement {
    sid       = "ListBackupBucket"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [var.bucket_arn]
  }
}

resource "aws_iam_role_policy" "backup" {
  name   = "${var.name_prefix}-backup-write"
  role   = aws_iam_role.vm.id
  policy = data.aws_iam_policy_document.backup.json
}

resource "aws_iam_instance_profile" "vm" {
  name = "${var.name_prefix}-vm-profile"
  role = aws_iam_role.vm.name
}
