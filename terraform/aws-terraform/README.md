# MyApartment on AWS: one EC2 + Docker Compose, cost-guarded (Terraform)

Creates in a new AWS account (default region ap-south-1, Mumbai):

| Piece | What | Cost note |
|---|---|---|
| EC2 | Ubuntu 24.04, t4g.small (ARM) by default, 30 GB encrypted gp3, CPU credits `standard` | about $8/month (free trial reported until 31 Dec 2026) |
| Network | Own VPC, one public subnet, **security group with zero inbound rules** | free |
| Public IPv4 | needed for outbound (SSM, tunnel, registries) | about $3.65/month |
| Access | SSM Session Manager (no SSH, no port 22) | free |
| IAM | Instance role: SSM + write-only access to the backup bucket | free |
| S3 | Private, encrypted bucket for encrypted DB dumps, auto-expiry | pennies |
| Budgets | (1) gross usage with credits excluded, alerts at $5/$10/$20/ceiling; (2) cash spend with credits applied | free (2 budgets) |
| Optional | Cost Anomaly Detection, GitHub Actions deploy over SSM via OIDC | free |

Expected total: about $15/month at list price after the free window. Your credit covers the first months.
It does NOT create: NAT gateway, VPC endpoints, load balancer, RDS, Elastic IPs, snapshots, CloudWatch log shipping.

## Queue option (no rewrite later)

`queue_backend = "pgboss"` (default): jobs run in Postgres, no Redis container, saves about 150 MB RAM.
`queue_backend = "redis"`: adds a Redis container (Compose profile) and sets `REDIS_URL`.

Your app code talks to one interface, `app-snippets/queue/`. It picks the adapter from `QUEUE_BACKEND`. Copy that folder into
your app. To switch later, on the VM edit `/opt/myapartment/.env`:

```
# to Redis                         # to pg-boss
QUEUE_BACKEND=redis                QUEUE_BACKEND=pgboss
COMPOSE_PROFILES=redis             COMPOSE_PROFILES=
REDIS_URL=redis://redis:6379       (remove REDIS_URL)
```
then `docker compose up -d`. Terraform only sets the first-boot default (it never replaces a running server).
Jobs already queued in the old backend are not migrated: drain them first.

## Layout

```
.
|-- main.tf variables.tf outputs.tf providers.tf versions.tf
|-- terraform.tfvars.example     copy to terraform.tfvars
|-- backend.tf.example           optional remote state in S3
|-- app-snippets/queue/          pg-boss and BullMQ adapters behind one interface
|-- examples/github-deploy.yml   CI: build, push to GHCR, deploy over SSM
`-- modules/
    |-- network/   VPC, subnet, IGW, security group (no inbound)
    |-- iam/       EC2 role + instance profile
    |-- storage/   backup bucket, lifecycle, TLS-only policy
    |-- compute/   EC2, cloud-init, compose + backup + env scripts
    |-- budgets/   two budgets + optional anomaly detection
    `-- ci_deploy/ optional GitHub OIDC role limited to this instance
```

## Step 0. AWS account preparation (console, once)

1. Secure the root user: enable MFA. Do not create access keys for root.
2. Create an admin identity for Terraform. Easiest: IAM Identity Center user with the AdministratorAccess
   permission set (or an IAM user with AdministratorAccess and MFA). You can narrow it later.
3. Billing > Account > "IAM user and role access to Billing information": **Activate** (needed for budgets when
   you are not root).
4. Open Cost Explorer once in the console so it is enabled (needed for anomaly detection).
5. Check Billing > Credits for your $100 balance and expiry. On the new Free Plan the account closes after 6 months or
   when credits run out. Upgrade to the Paid plan before then if you want to keep the account.

## Step 1. Laptop tools

1. Terraform 1.5 or newer, AWS CLI v2.
2. Session Manager plugin for the AWS CLI (needed for `aws ssm start-session`).
3. Log in: `aws configure sso` (or `aws configure`), name the profile `myapartment`, then
   `aws sts get-caller-identity --profile myapartment` should print your account.
4. Backup key (keep the PRIVATE key offline in your password manager, never on the server):
   ```bash
   age-keygen -o age-key.txt     # prints: Public key: age1...
   ```

## Step 2. Configure and create

```bash
cp terraform.tfvars.example terraform.tfvars
# edit: aws_profile, alert_email, ceiling_usd, age_public_key, app_image, queue_backend
terraform init
terraform fmt -check -recursive && terraform validate
terraform plan
terraform apply
```
Confirm the budget emails: AWS sends subscription confirmation links to `alert_email`.

## Step 3. First login (no SSH)

```bash
terraform output ssm_session_command      # copy and run it
# inside the session:
sudo cloud-init status --wait              # wait for: status: done
sudo -iu deploy
cd /opt/myapartment && ls -la              # docker-compose.yml  .env  backup.sh
docker --version && free -h && swapon --show
```

## Step 4. Add secrets and start the stack

1. Edit `.env` (`nano .env`): uncomment and fill APP_BASE_URL, AUTH0_*, R2_*, RESEND_API_KEY, VAPID_*, TUNNEL_TOKEN.
   The database password and DATABASE_URL were generated for you.
2. If your GHCR image is private: `echo <token> | docker login ghcr.io -u <user> --password-stdin`
   (classic token with `read:packages`).
3. `docker compose pull && docker compose up -d`, then `docker compose ps`.
4. Create the Cloudflare Tunnel (runbook section 9): hostname `app.yourdomain.com` to `http://app:3000`.
5. Run your DB migrations once (for example `docker compose run --rm app npm run migrate`, if your image ships the
   migration command; otherwise add a migrate target as in the runbook).

Admin access later: `aws ssm start-session ...` for a shell. For a one-off DB tunnel to your laptop:
`aws ssm start-session --target <id> --document-name AWS-StartPortForwardingSession ...` (Postgres is not published to the
host, so use `docker compose exec db psql` inside the session instead).

## Step 5. Backups

- Nightly at 21:00 UTC (02:30 IST): `pg_dump`, encrypted with your age PUBLIC key, uploaded to the bucket.
- The VM role can write and read but **not delete**. Objects expire after `backup_retention_days` via bucket lifecycle.
- Test now: `sudo -iu deploy /opt/myapartment/backup.sh`, then check the bucket (`terraform output backup_bucket`).
- Restore test (monthly): on your laptop with the PRIVATE key:
  ```bash
  aws s3 cp s3://<bucket>/db/<file>.dump.age . --profile myapartment
  age -d -i age-key.txt <file>.dump.age > restore.dump
  # then pg_restore into a throwaway Postgres container
  ```
- If `AGE_PUBLIC_KEY` is empty in `.env`, the script refuses to run (it never uploads plaintext).

## Step 6. Optional: deploy from GitHub Actions over SSM

1. In `terraform.tfvars`: `enable_ci_deploy = true`, `github_repo = "owner/repo"`, then `terraform apply`.
   (Set `create_github_oidc_provider = false` if your account already has a GitHub OIDC provider.)
2. In GitHub: secret `AWS_DEPLOY_ROLE_ARN` = `terraform output ci_deploy_role_arn`; variable `EC2_INSTANCE_ID` = `terraform output instance_id`.
3. Copy `examples/github-deploy.yml` to `.github/workflows/deploy.yml`.
The role can only send shell commands to this one instance and read the results. If you use t3.small, change the build platform to linux/amd64.

## Step 7. Cost checks (do these)

- Day 1: Billing > Free Tier / Bills: confirm EC2 hours show the t4g free trial or are covered by credits.
- Weekly for the first month: Cost Explorer grouped by Service. Expect EC2, EBS, VPC (public IPv4) and tiny S3. Anything else is a surprise.
- Alerts you get: gross usage at $5, $10, $20 and the ceiling; cash spend above `cash_alert_usd`; anomalies if enabled.
  $5 and $10 are normal pacing markers. $20 means investigate. Budgets only notify, they do not stop anything.
- Optional hard stop: in the Budgets console add a budget action to stop the EC2 instance at the ceiling (not in this Terraform).

## Things to know

- t4g launches default to unlimited CPU credits, which can bill. This code sets `standard` (throttles instead).
- `lifecycle.ignore_changes = [ami, user_data]` stops Terraform replacing a running server when Ubuntu publishes a new AMI.
  Rebuilding on purpose: `terraform apply -replace=module.compute.aws_instance.this` (destroys data on the volume, restore from S3).
- Memory is tight on 2 GiB: container limits are set (db 600m, app 600m, worker 256m, cloudflared 100m, redis 150m)
  plus a 2 GB swapfile. Watch `docker stats`. If the app is OOM-killed, move to t4g.medium (edit the guard list in
  `modules/compute/variables.tf`; it costs about double).
- Costs I did not verify exactly: EBS and S3 per-GB prices in Mumbai. They are small, but confirm in the AWS pricing calculator.
- The instance's metadata is IMDSv2-only with hop limit 1, so containers cannot read the instance role. Only the host-side backup uses it.
- Run `terraform fmt` and `terraform validate` first: this code was written without being executed against AWS.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `InsufficientInstanceCapacity` | Set `az_index = 1` (or 2) and apply again. |
| `UnauthorizedOperation` on budgets | Step 0 item 3 (IAM billing access) not activated. |
| Anomaly detection error | Open Cost Explorer once, wait, then set `enable_anomaly_detection = true`. |
| Instance not in Session Manager | Wait 3-5 minutes; check the role has `AmazonSSMManagedInstanceCore`; the VM needs outbound internet (it has a public IP). |
| `aws ssm start-session` fails locally | Install the Session Manager plugin. |
| Compose says `redis` not found | You set COMPOSE_PROFILES=redis without the service, or an old compose file: re-copy the template. |
| Backup script exits "AGE_PUBLIC_KEY is empty" | Put your `age1...` key in `.env` as AGE_PUBLIC_KEY. |
| `BucketAlreadyExists` | Bucket names include your account ID; change `name_prefix`. |

## Tear down

```bash
terraform destroy    # the backup bucket has force_destroy = false: empty it first if it contains objects
```
