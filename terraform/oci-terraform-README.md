# MyApartment: Oracle Always Free VM with Terraform

Creates, in a brand-new Oracle Cloud account, everything the runbook needs:
VCN, public subnet, internet gateway, outbound-only firewall, ONE Ampere A1 VM
(2 OCPU / 12 GB / 50 GB boot, Ubuntu 24.04 arm64) bootstrapped with Docker, Tailscale,
fail2ban and a hardened SSH config, plus an optional budget alert.

It does NOT create a reserved IP, load balancer, extra block volumes or a bigger shape
(all can bill). The plan fails if you ask for more than the free allowance.

## Why Terraform (instead of clicking in the console)

- Disaster recovery: if Oracle reclaims or loses the VM, `terraform apply` rebuilds it in minutes.
- Guard rails: variable validation blocks accidental paid sizes.
- Repeatable: the same code can later build a standby elsewhere.
Console is fine for a one-off, but you are a DevOps developer, so use Terraform.

## Layout

```
.
|-- main.tf  variables.tf  outputs.tf  providers.tf  versions.tf
|-- terraform.tfvars.example   (copy to terraform.tfvars)
|-- backend.tf.example         (optional remote state in R2)
|-- retry-apply.sh             (loops until A1 capacity appears)
`-- modules/
    |-- network/   VCN, IGW, route table, security list, subnet
    |-- compute/   A1 instance, image lookup, cloud-init bootstrap
    `-- budget/    tenancy budget + email alert
```

## Step 0. On your laptop

1. Install Terraform 1.5 or newer.
2. Create an SSH key if you have none: `ssh-keygen -t ed25519 -C "myapartment"`
3. Create a free Tailscale account and install it on your laptop. In the admin console go to
   Settings > Keys > Generate auth key: **single use, expires in 1 day**, not ephemeral. Copy it.
   (Skip this only if you prefer plain SSH: then set `ssh_allowed_cidrs` to your IP/32.)

## Step 1. Bootstrap the new Oracle account (console, one time)

1. Sign in and make sure the home region is **Hyderabad (ap-hyderabad-1)**. It was fixed at sign-up.
2. Wait until the account shows as fully provisioned (the welcome email can take a while).
3. Create an API key so Terraform can authenticate:
   profile icon (top right) > My profile > API keys (may be labelled "Tokens and keys") >
   **Add API key** > Generate API key pair > download the private key >
   **Add**. A "Configuration file preview" box appears.
4. Copy that preview into `~/.oci/config`, change `key_file=` to the path where you saved the private key, then:
   ```bash
   mkdir -p ~/.oci && chmod 700 ~/.oci
   chmod 600 ~/.oci/config <your-private-key>.pem
   ```
   The `tenancy=` value in that file is your `tenancy_ocid`.
5. Optional but useful: Billing > upgrade to Pay-As-You-Go. You still pay $0 inside free limits, and it is
   often reported to help with the "Out of host capacity" error. Do this first if Step 3 keeps failing for a day.

## Step 2. Configure

```bash
cp terraform.tfvars.example terraform.tfvars
# edit: tenancy_ocid, tailscale_auth_key, alert_email, budget_amount
```

`budget_amount` is in your billing currency. Use about 1 for USD. If the account bills in INR, use about 100,
otherwise a 1-rupee budget alerts instantly.

## Step 3. Create

```bash
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan
terraform apply            # or: ./retry-apply.sh   if you hit "Out of host capacity"
```

`retry-apply.sh` re-runs apply every 60 seconds until Oracle has Ampere capacity. Leave it running in a
terminal or `tmux`. It is safe to re-run.

## Step 4. Verify (about 5 minutes after apply, cloud-init is still installing)

```bash
tailscale status | grep myapartment-vm        # machine appeared in your tailnet
ssh deploy@myapartment-vm                     # no public SSH needed
cloud-init status --wait                      # expect: status: done
cat /var/lib/cloud/instance/myapartment-bootstrap-done
nproc && free -h && df -h /                   # 2 CPUs, about 12 GB RAM, about 50 GB disk
docker --version && docker compose version
sudo tailscale ip -4
```

If you did not use Tailscale: `ssh deploy@<public_ip>` (shown in the Terraform outputs) from an allowed CIDR.

## Step 5. Next steps (see the main runbook)

1. Copy `docker-compose.yml` and `.env` to `/opt/myapartment` (owned by `deploy`).
2. `docker login ghcr.io` once with a classic token that has `read:packages`.
3. Create the Cloudflare Tunnel and put `TUNNEL_TOKEN` in `.env`, then `docker compose up -d`.
4. Allow `tag:ci` in your Tailscale ACLs so GitHub Actions can SSH in over Tailscale.
5. Next day: Billing > Cost Analysis should show $0. The console price estimate for the boot volume is
   list price and does not reflect the free allowance.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Out of host capacity` | Use `./retry-apply.sh`, try another `availability_domain_index`, try off-peak hours, or upgrade to Pay-As-You-Go. |
| `404 NotAuthorizedOrNotFound` | Wrong `tenancy_ocid`, or the API key/profile is not the one in `~/.oci/config`. |
| `401 NotAuthenticated` | Fingerprint or key path in `~/.oci/config` is wrong. Re-add the API key. |
| Variable validation error | You asked for more than 2 OCPU, 12 GB or 200 GB. Free limits can change, check Oracle's Always Free page before raising them. |
| VM not in `tailscale status` | Auth key expired or already used. SSH via a temporary `ssh_allowed_cidrs`, then run `sudo tailscale up --ssh`. Logs: `/var/log/cloud-init-output.log`. |
| Budget creation fails | Your user needs budget permissions (tenancy admins have them). Set `create_budget = false` and create it in the console. |

## Things to know

- `lifecycle.ignore_changes` stops Terraform from replacing a running VM when Oracle publishes a newer
  Ubuntu image or when you edit cloud-init. Changing cloud-init later means changing the VM by hand
  (or deliberately `terraform taint` / `-replace`, which destroys the VM and its data).
- The Tailscale auth key is stored in Terraform state and in the instance metadata. Use a single-use,
  1-day key, and keep state private (local file, or a private R2 bucket via `backend.tf.example`).
- Postgres data lives on the boot volume. Backups to R2 (runbook section 14) are what protect you.

## Tear down / rebuild

```bash
terraform destroy      # deletes the VM and its boot volume (preserve_boot_volume = false)
```
Afterwards check Compute > Boot Volumes in the console: it should be empty, otherwise delete leftovers.
