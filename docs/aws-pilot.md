# AWS pilot deployment and launch plan

Status: deployment foundation prepared; **not a production-supported release or an approved launch**. No AWS, Cloudflare, Auth0, or Resend resources have been changed. Real deployment, restore, abuse, and capacity evidence is still required. See [security and operations](security-and-ops.md).

## Agreed scope (25 October 2026)

- AWS Free plan, $100 credits, reported expiry April 2027. Confirm the exact date in Billing; credits can run out earlier.
- `block9.online`, Cloudflare Free, AWS Mumbai (`ap-south-1`).
- Pilot of 100–200 residents; brief maintenance downtime and daily backups acceptable. Resident count is not concurrent load.
- Keep Auth0 and Resend; switch to dedicated production credentials and applications.
- Operator access through AWS Systems Manager Session Manager, plus the existing Auth0 subject allowlist.
- Cash/bank and offline payment reporting only. Checkout, SMS/WhatsApp OTP, campaigns, exports, and worker jobs remain disabled or unavailable. Their absence does not require buying providers for this pilot.

## Cost boundary and expiry

AWS Free plan is temporary credit-funded hosting. It ends after six months or credit exhaustion, whichever occurs first, and AWS closes the account with loss of resource access. The reported April 2027 date is an upper bound, not six months of guaranteed capacity. Do not upgrade the account or enable a paid fallback without the owner's explicit approval. See [AWS plan rules](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

$100 across roughly six months permits approximately **$16.67 per month of total credit consumption** before any safety reserve. Set a planning ceiling of $13/month and retain the rest for recovery/overruns; this is a target, not a verified estimate. A server large enough for this stack may exceed it. If the measured configuration costs more, shorten the pilot or obtain approval for another budget; do not promise operation through April. Free plans have restricted service/instance availability: verify the console before selecting a machine.

Use the [AWS Pricing Calculator](https://calculator.aws/) in Mumbai before provisioning. Record the estimate, chosen instance, architecture, EBS size, S3 retention, and eligible credits in a private release record. Include EC2 hours, CPU surplus credits, encrypted EBS, public IPv4, S3 storage/requests/versions, internet egress, registry storage/transfers, and monitoring. Public IPv4 list price is $0.005/hour (about $3.65 per 730 hours before applicable benefits); see [AWS IPv4 pricing](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/). Cloudflare does not remove that cost from this design.

Do not assume legacy 750-hour EC2/RDS benefits or the T4g promotional trial apply to this Free plan. Avoid NAT Gateway, ALB, RDS, ElastiCache, EKS, paid Cloudflare features, extra servers, and marketplace AMIs in the baseline. They require separate estimates and approval. Stopped EC2 instances can still retain billable disks and IPs.

### Illustrative Mumbai estimate, checked 25 October 2026

The architecture direction is selected; the exact instance and disk size are **not finalized**. For a comparable list-price estimate, assume Linux On-Demand, 730 hours/month, one public IPv4, 40 GB total gp3 EBS at baseline IOPS/throughput, and 10 GB total retained compressed S3 backups across all versions. These assumptions are not measured application usage or an account-specific quote.

- A `t4g.medium` (2 vCPU, 4 GiB ARM64) is $0.0224/hour, approximately **$16.35/month**. It is a price/capacity reference only: AWS's documented new-account eligible instance list includes `t4g.small`, not `t4g.medium`. Do not upgrade to Paid to obtain it without approval.
- A `t4g.small` (2 GiB ARM64) is $0.0112/hour, approximately **$8.18/month**, but its capacity is unverified for this stack. `t3.small` (2 GiB x86) is $0.0224/hour, approximately **$16.35/month** in Mumbai. Architecture and eligibility matter as much as the instance name.
- 40 GB gp3 at $0.0912/GB-month is approximately **$3.65/month**. This is total provisioned disk, not just occupied database space; avoid unintentionally adding a second chargeable root/data disk beyond the estimate.
- One public IPv4 at $0.005/hour is approximately **$3.65/month** before account benefits. An Elastic IP uses the same public IPv4 billing category and provides address stability; it is not a second free address. Budget one address and release unused addresses.
- 10 GB retained S3 Standard backup storage at $0.025/GB-month is approximately **$0.25/month**, plus requests. This means total retained storage, not 10 GB per daily dump. Seven 10 GB dumps would consume about 70 GB and cost approximately $1.75/month for storage alone, before versions/requests.

The 4 GiB reference subtotal is about **$23.90/month**. Use **$25–30/month as an initial planning allowance**, adding room for registry, monitoring, requests and modest variable usage. This allowance is not a cap and excludes tax, domain renewal, external provider plan upgrades, substantial egress, excess CPU/IOPS and unusual backup growth. The analogous 2 GiB ARM subtotal is about **$15.73/month before those extras**; it cannot be assumed to meet the $16.67 six-month allowance or the capacity gate.

At $25–30/month, $100 credits provide approximately **3.3–4 months**, assuming the full balance remains and credits cover all modeled usage. The account may close before April 2027. The original $13/month target is therefore not met by the 4 GiB reference. The next decision is a tested eligible smaller configuration or a shorter pilot, not an implicit paid upgrade.

Rates were extracted from the [official AWS Mumbai EC2/EBS price catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-south-1/index.csv) (effective 1 October 2026) and [official AWS Mumbai S3 catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-south-1/index.json). Check [AWS instance eligibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/LaunchingAndUsingInstances.html) and [public IPv4 pricing](https://aws.amazon.com/vpc/pricing/) against the account console before launch. Actual credits, benefits and available services can change the net consumption.

Enable Free Tier and credit notifications, and budget notifications at 50%, 75%, and 90% of the approved monthly credit target where available. Check Billing weekly. [Budgets notifications can lag and do not impose a hard spending cap](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html). Review remaining runway weekly. Set an exit review for **1 March 2027**, or immediately when less than 30 days of estimated credits remain. Export an encrypted backup outside this AWS account before expiry; an S3 copy in the same closed account is not accessible recovery.

## Architecture and capacity gate

One EC2 host runs production Docker images for four Next.js apps, the Node API, Postgres 16, Redis 7, and Caddy. The worker is a health stub and is excluded. Public traffic reaches Caddy on 80/443; Caddy proxies the login, resident, and admin apps. Their server-side `/api/backend` routes call the private API. There is no public API hostname. Postgres and Redis publish no host ports. Operator HTTPS listens only on host loopback 8443 and requires an SSM tunnel.

The intended AWS network is one VPC, one public subnet in one Mumbai Availability Zone, a route to an Internet Gateway, and one public IPv4 on the EC2 host. These AWS resources are a deployment plan, not provisioned infrastructure. There is no NAT Gateway, load balancer, or paid private VPC endpoint in the baseline. SSM, Auth0, Resend, registry pulls and S3 use outbound HTTPS over the host's internet path. Private application/database connectivity here means Docker's internal network and unpublished ports; it does not mean a separate AWS private subnet or database server. DNS and the VPC route do not determine tenant authorization. The EC2 security group and host configuration enforce network exposure; API identity/membership guards enforce data access.

All application containers and Postgres share the same host and Availability Zone. A host failure affects every app; there is no automatic failover. EBS-backed Docker volumes retain data through container replacement and ordinary host reboots, but do not substitute for backups. Review EBS DeleteOnTermination settings and termination protection together; retained volumes continue consuming credits after server termination. Restore service using the agreed backup process after unrecoverable disk/host loss.

Use a minimal supported Linux AMI, encrypted gp3 EBS, IMDSv2 required, EC2 termination protection, and a narrowly scoped instance role. Start with a **4 GiB memory capacity candidate** if eligible and affordable, using ARM64 only when all release images were built and tested for ARM64. This is an engineering starting point, not a measured minimum or free-tier eligibility claim. A 1 GiB micro is not an accepted capacity baseline for this stack. A 2 GiB candidate requires the same load gate and may fail it. Select Standard CPU credit mode for burstable instances where supported to avoid surplus credit charges, accepting throttling risk. Do not use Spot for the database host.

Build images on a separate trusted machine/CI, sequentially if necessary. Existing images include build dependencies; measure disk usage and prune only unused images after rollback retention is secured. Never build on the small live server. Keep at least 25% disk space free and allow room for current/previous images, Postgres growth and complaint photos. Build context excludes `.env*`; inject credentials only at runtime. Scan images and dependencies, patch reported exploitable issues, and record digests. Existing Dockerfiles run Node as a non-root user. Pin Postgres/Redis and OS packages to reviewed releases/digests in the release process too; the overlay retains their existing major-version tags pending that review.

Before resident access, exercise 20 simultaneous active sessions initially, then the actual expected peak agreed with the owner. Mix Auth0 sign-in, dashboards, invoice history, complaint photos, admin billing publication, and onboarding. Measure p95 latency, errors, memory/OOM events, CPU credits, database connections, and disk growth. Proposed acceptance: no OOM/restarts, no failed isolation checks, <1% unexpected errors, and p95 ordinary reads <2 seconds excluding external OTP delivery. Adjust the agreed target if the pilot needs more concurrency. Failure blocks launch; do not silently scale into paid resources. Multi-tenant connection pools are currently cached per database; include the actual number of organizations in the test.

## Services and credentials needed

No additional SaaS subscription is required by this baseline. Required AWS capabilities are EC2/EBS, S3 for backups, IAM, Systems Manager, and billing notifications. Validate availability under the Free plan first. Optional hosted uptime/error tracking is not needed to deploy, but someone must own outage and backup notifications. Cloudflare Free continues as DNS and optionally the public proxy. An image registry (existing private registry, ECR, or another approved registry) is needed to transfer release images; include any storage/transfer/build-runner costs in the estimate. No automatic publishing/deployment workflow is added.

Keep secrets in a deployment secret store (for example SSM Parameter Store SecureString where available) with permission limited to the production host and deployment owner. Review KMS/API costs in the estimate. Materialize `.env.production` to an encrypted disk with mode 0600 using an approved deployment process; do not shell-trace commands, print the resolved Compose configuration, commit the file, or pass secrets as build args. Docker administrators can read container environment variables and are privileged production operators. No AWS static access keys belong on EC2; use its instance profile.

Use separate production Auth0 Resident, Admin, Operator Regular Web Applications and a Management API M2M client. Preserve [existing Auth0 grants and connection settings](local-setup.md#auth0), including invitation-only membership and explicit invitation acceptance. Set exact callbacks `{origin}/auth/callback`, logout `{origin}/`, and allowed web origins to:

- Resident: `https://app.block9.online`
- Admin: `https://admin.block9.online`
- Operator: `https://ops.block9.online:8443`

The login site is `https://login.block9.online`; it has no Auth0 app/session. Generate three independent secrets with `openssl rand -hex 32`. `OPERATOR_IDS` contains exact approved Auth0 subjects; the primary `OPERATOR_ID` must be in that list. Auth0 tenant membership/role claims do not replace platform membership authorization.

Verify `block9.online` (or an approved sending subdomain) in Resend, including SPF/DKIM and a reviewed DMARC policy in Cloudflare DNS. Use an appropriate sender such as `no-reply@block9.online`. Configure **Auth0 email delivery through Resend too**: Auth0's test email provider is unsuitable for production. Use the [official Resend integration](https://auth0.com/blog/integrating-resend-with-auth0-email-delivery/) if available in your tenant, or [Resend SMTP](https://resend.com/docs/send-with-smtp) with `smtp.resend.com`, STARTTLS 587, username `resend`, and a separately scoped API key as password. Test the passwordless From address. No OTP issuer changes. Confirm current Auth0 active-user limits and Resend daily/monthly send limits in your dashboards; OTP plus invitations can exhaust email quota even at 100–200 residents. Monitor failed delivery and bounces without logging OTPs or invitation tokens.

## Cloudflare and ingress

Create A records for `login`, `app`, `admin`, and `ops` under `block9.online` pointing to the EC2 public address. Do not publish AAAA records unless IPv6 routing/firewall rules are tested. Initially keep all four DNS-only so Caddy can obtain public certificates through HTTP challenges on port 80. Restrict DNS administration with MFA. Public DNS for `ops` enables certificate issuance; it does not grant access to the loopback HTTPS service.

After certificates work, the three public apps may be proxied through Cloudflare using [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/), never Flexible. Leave `ops` DNS-only. Bypass Cloudflare cache for authenticated responses, `/api/*`, `/auth/*`, and service-worker files. Do not enable Cache Everything for these apps. Confirm ACME renewal still works through proxy/security rules. Do not enable paid features. Cloudflare proxying alone does not prevent direct origin access and is not the operator's private ingress control.

EC2 security group: inbound TCP 80 and 443 only; no SSH, 3000/3101, 4001, 5432, 6379, or 8443 from the internet. Apply the same restriction to IPv6 if enabled. SSM needs outbound HTTPS and a managed-node instance role/agent. Restrict administrator IAM to this instance and approved SSM documents, require MFA, and record operator onboarding/offboarding. Port-forwarded payload is not captured as an application audit trail; retain existing application operator audits. Restrict other local users because loopback is reachable from the host.

For operator access install AWS CLI and Session Manager plugin on the operator's laptop, authenticate using short-lived credentials, and run:

```sh
aws ssm start-session --region ap-south-1 --target i-REPLACE_WITH_INSTANCE \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8443"],"localPortNumber":["8443"]}'
```

Add `127.0.0.1 ops.block9.online` to the laptop hosts file while using the tunnel, then visit `https://ops.block9.online:8443`. Keep the DNS hostname for TLS and Auth0 callbacks; do not browse to `localhost`. Remove the hosts entry when no longer needed. From outside the tunnel, port 8443 and operator pages on 443 must be unreachable. See [SSM port forwarding](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html).

## Release and migrations

Use Docker Compose **2.24.4 or newer** (`!reset` support) and Node 22+ for the deployment validator. From the repo root, copy `infrastructure/aws/pilot.env.example` to `.env.production`, chmod it to 0600, and populate via the secret process. `POSTGRES_PLATFORM_URL` and `POSTGRES_TENANT_URL` use internal `postgres:5432`, URL-encoded passwords, and databases `myapartment_platform_db` / `myapartment_tenant_template`. All six image inputs require immutable digests. Do not use development overrides, profiles, or `docker compose config` output in logs.

```sh
node scripts/validate-production.mjs .env.production
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml pull
```

First boot on a **new** volume: start only Postgres and Redis, wait for health, then apply missing tenant SQL before starting the apps. Init installs platform 001–009 and tenant 001–029. This runner has no migration ledger: record each successful file/database privately and never replay already applied files. If a file fails midway, inspect and reconcile it before retrying; do not blindly rerun.

```sh
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --wait postgres redis
COMPOSE_FILE=compose.yaml:compose.production.yaml COMPOSE_ENV_FILES=.env.production \
  scripts/run-migrations.sh tenant all-tenants \
  030_bulk_resident_imports.sql \
  031_property_setup_deletion.sql \
  032_delete_all_property_setup.sql \
  033_apartment_setup.sql \
  034_readable_work_references.sql \
  035_minutes_of_meeting.sql
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --no-build --wait
```

For existing volumes determine the actual applied migrations first; do not use the first-boot command unchanged. Keep every tenant and the template current. Do not run migrations with resident traffic active. Database provisioning/deletion currently shares the API database credentials; the baseline uses the postgres role to match existing behavior. **Separate ordinary runtime access from database lifecycle privileges before live resident launch**; this is an open security gate, not solved by private networking. It requires an explicit role/ownership migration and tested provisioning/deletion, not simply changing the username.

Before each release run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` on the trusted build machine; run the database suite with `MYAPARTMENT_DATABASE_TESTS=1` against an isolated migrated Postgres, never production. Save the previous digests and config version (without secrets) plus migration state. Take a verified pre-migration backup, stop app writes, apply only new migrations, and recreate affected services. API route/schema changes require a rebuilt API image and restart. Do not use `down --volumes`.

Rollback: stop writes and redeploy previous immutable digests only if their schema remains compatible. Otherwise restore the complete pre-release database backup into a separate replacement environment, validate it, then switch ingress. SQL down migrations are not assumed. Never overwrite the sole live database while testing a rollback. A restore loses changes since that backup; notify the owner and residents according to the agreed incident process.

## Backups, restore, and ownership

Proposed pilot policy: daily maintenance backup plus pre-release backups, RPO up to 24 hours, **target RTO 4 hours subject to a measured restore drill**, 7-day daily retention initially. Owner must approve retention/legal hold requirements. Complaint photos live in Postgres and are included. Redis is not the authoritative resident data store. Preserve production secret recovery separately, including session keys/Auth0 client settings, infrastructure configuration and release digests. Caddy certificates can be reissued subject to issuer limits.

Create a private S3 bucket in Mumbai with Block Public Access, encryption, TLS-only bucket policy, versioning, lifecycle expiry for current and noncurrent backup versions, and incomplete multipart upload cleanup. Retention must account for versioning; expiring only current objects does not remove noncurrent data. The EC2 role needs `s3:PutObject` only for its backup prefix, plus multipart permissions if needed. Use a separate recovery role with read permissions, and administrator-only deletion/lifecycle changes. No cross-account transfer, Object Lock, or paid KMS key is assumed. Estimate S3 costs. Keep an encrypted recent copy outside this account with owner-controlled access; decide its location before live data.

After all apps are running, the script validates configuration, stops all app writers, streams `pg_dumpall` through gzip directly to S3 with SSE-S3, and restarts the apps on success or failure:

```sh
bash scripts/backup-production.sh s3://REPLACE_WITH_PRIVATE_BUCKET/database
```

Schedule with a root-owned systemd service/timer or cron in a documented maintenance window. Use an exclusive lock such as `flock` so backup and deployment cannot overlap; do not allow manual SQL writes during the dump. Grant the backup job only necessary OS/instance-role access. Alert on nonzero exit, restart failures, missing daily objects, and restore-drill failures; Docker restart policies do not heal unhealthy containers. Retain only redacted operational logs, no dump text or resolved environment. Confirm apps become healthy after the job. An uploaded object alone is not restore evidence.

Restore drill: on an isolated host/network with adequate disk and no outbound email/Auth0 credentials, start a fresh Postgres 16 with **no application init scripts**. Download the chosen backup using the recovery role, verify gzip integrity, and restore with `psql -v ON_ERROR_STOP=1` into that cluster. A stock cluster already contains role `postgres`: skip only the dump's exact `CREATE ROLE postgres;` line, or prepare the restore role bootstrap to avoid this expected conflict. Other restore errors must fail the drill. `pg_dumpall` includes password hashes; treat both the dump and restored cluster as secrets. Never run the SQL against the live cluster. Verify platform records, every tenant database/schema, tenant template through 035, row counts, invoice totals, complaint photos, membership isolation, and immutable Minutes of Meeting. Bring up the selected release only with delivery integrations disabled or an isolated staging setup. Record elapsed recovery time, backup timestamp/checksum, checks and reviewer. Delete the isolated data securely after review. Run before launch and monthly thereafter.

## Remaining launch gates

- Confirm exact credit expiry, service eligibility, and a Mumbai cost estimate within an approved pilot runway. No billable resources are provisioned by this change.
- Publish and scan images for the chosen CPU architecture; validate Caddy configuration/certificate issuance and renewal on the actual deployment.
- Resolve database runtime/provisioning privilege separation; test database-backed isolation and onboarding/deletion against the new roles.
- Add and test server-side abuse controls for OTP initiation/verification and invitation lookup/acceptance (per identity and trustworthy client source, with bounded storage). Cloudflare rules and Auth0 limits alone do not prove this application's protection. Test quotas and error behavior without sending bulk real emails.
- Verify secure cookies, forwarded HTTPS origin handling, CSRF/session expiry, invite address matching, expired/reused invite rejection, suspended/ambiguous memberships, and fail-closed operator access. No cross-tenant data or token/PII logging.
- Verify no public DB/Redis/API/worker/operator ports, public operator denial, SSM access/revocation, Auth0/Resend email delivery, DNS/TLS and authenticated cache bypass.
- Complete the load/memory/disk/connection test, dependency/image review, and database-backed full test suite. Proposed limits do not certify capacity.
- Assign a named release approver and incident/rollback owner; configure health/resource monitoring and tested failure notifications. Keep metrics/log retention bounded and budgeted. At minimum monitor public app health, private API readiness, disk/memory/OOM, CPU credits, TLS expiry, daily backup freshness, and email failures. Health endpoints alone do not prove customer workflows.
- Perform and time a restore drill; schedule daily backups and off-account exports; approve retention, privacy notice, support contact and recovery expectations.

These gates distinguish prepared deployment files from an operationally verified launch. No extra payment, messaging, file-storage, push, queue or analytics provider is required for the scoped pilot.

## Repository verification for this preparation

`pnpm typecheck`, `pnpm lint`, and `pnpm build` passed after refreshing the existing locked workspace dependencies. Build warnings remain for Auth0's dynamic dependency loading, missing build-time Auth0 settings, ESLint Next integration, and existing CSS compatibility. Production runtime credentials still need real authentication smoke tests. Two outdated localization test expectations were aligned with the existing Dashboard translations; product copy was unchanged.

The full non-database test run passed 104 tests, with 85 database-backed tests skipped. After extending backup recovery checks, all seven deployment/backup safeguard tests passed, as did targeted lint and script syntax checks. Compose rendering was exercised without a daemon using synthetic configuration. Tests confirm removal of inherited local ports/builds, private operator binding, configuration rejection without secret output, backup write quiescence, and app restart after upload failure. They do not prove a live restore or cloud ingress.

Docker daemon was unavailable, so container image execution, Caddy validation/TLS, Postgres integration/restore tests, and capacity tests were not performed. AWS CLI was unavailable and no connected cloud deployment credentials were used. Deployment and all cloud-side launch gates remain pending.
