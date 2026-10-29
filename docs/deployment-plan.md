# Production Deployment Plan

Status: proposal for pilot and production release. This is not authorization to deploy secrets or resident data until the production gates in [security-and-ops.md](security-and-ops.md) are closed.

Prepared from official provider documentation and this repository on 29 October 2026. Prices, promotions, and free allowances change; verify the linked official pages before provisioning and configure billing alerts.

## Executive recommendation

### Pilot / PoC: single AWS EC2 VM with Docker Compose

With OCI capacity unavailable, use a single EC2 VM and the repository's Docker Compose topology for the initial pilot. This does not require permanent zero-cost infrastructure; it uses the AWS account's $100 credit for the pilot period.

Start with **t4g.small or t3.small** in `ap-south-1` (Mumbai). Use ARM64 AMIs and Docker images only if every image is known to support ARM64; otherwise launch an AMD64 instance.

- Docker Compose runs Nginx, all four web apps, API, worker, PostgreSQL, Redis, and optional Better Auth.
- Keep public exposure closed where possible: use Security Groups, Tailscale, AWS Systems Manager Session Manager, or Cloudflare Tunnel instead of opening SSH/HTTP broadly.
- Use an Elastic IP or public IPv4 only if deployment needs one; public IPv4 addresses incur AWS charges even while an instance runs.
- PostgreSQL and Redis stay in Compose only for pilot. Back up PostgreSQL to S3 and test restoration.

This is a **credit-funded pilot, not permanent zero-cost hosting and not a production HA architecture**. The $100 credit is limited and AWS resource rates are separate from credits. Add immediate AWS Budgets billing alarms and review Cost Explorer at least weekly.

Zero/low-cost alternatives to an EC2 pilot are limited because most PaaS free tiers pause, expire, or exclude managed data:

- **Oracle OCI Always Free:** retain as a fallback if capacity becomes available, but capacity and reclamation policy are still risks.
- **AWS Lightsail:** fixed-price VPS bundles can be simpler; verify credit eligibility, IPv4, storage, snapshots, transfer, and database addon costs before choosing it.
- **Hetzner/DigitalOcean VPS:** low fixed-cost alternatives, without the AWS credit. Use managed PostgreSQL/backups for serious production data.

### Final production: managed, vertically scalable platform

Do not start with an over-engineered Kubernetes cluster. Prefer one of these final paths:

1. **Best operational fit (AWS):** ECS on EC2 or Fargate, Amazon RDS PostgreSQL, ElastiCache Redis or a managed external Redis service. Redis is optional operationally and must be private. Application Load Balancer, ACM/TLS, Secrets Manager, S3, CloudWatch, GitHub Actions/OIDC.
2. **Lowest-cost production VPS:** OCI paid ARM or a Hetzner/DigitalOcean VPS, managed PostgreSQL recommended, Docker Compose or systemd, Cloudflare/AWS route.
3. **Fastest managed PaaS:** Render or Railway with managed PostgreSQL/Redis, separate web/API services, secret manager and managed TLS. Higher predictable-enough cost than an OCI VM, but lower operations burden.
4. **Serverless/workflow split:** Vercel for Next.js + managed Postgres (Neon/Supabase) + Upstash Redis + separate API/worker hosting. This requires careful compatibility testing because the app currently uses stateful Node processes and PostgreSQL.

AWS ECS on an EC2 instance is more manageable than Kubernetes, but it is **not a free EC2 tier for this workload**. Keep infrastructure and application images ARM64-compatible if using Graviton/A1, or use AMD64 consistently.

## Provider comparison

| Option | Pilot cost pattern | Managed services | Production posture | Best use | Main risks |
|---|---|---|---|---|---|
| AWS EC2 + Compose pilot | Uses $100 account credit for approximately 6 months; EC2, EBS, IPv4, snapshots, and transfer consume credit | EC2, Docker, S3, optional SSM/Tailscale | One-node pilot only; weak HA/DR | Fastest low-cost AWS pilot matching Compose | Credit expiry, public IPv4 and data-transfer charges, self-managed PostgreSQL |
| OCI Always Free A1 VM | Potentially $0 compute for eligible account; capacity is the current blocker | VM/Docker only; PostgreSQL and Redis self-managed | Acceptable pilot; weak HA/DR | This monolith/Compose app if capacity becomes available | Capacity, reclamation, no automated HA, IPv4/TLS/egress limits must be checked |
| AWS managed | New accounts may receive credits; EC2/RDS/ECS benefit rules vary and are time-limited | ECS/EC2/Fargate, RDS, ElastiCache, ALB, Secrets Manager, CloudWatch | Strongest managed/SaaS option | Final production with India-first operation | Credit expiry; ALB/NAT/RDS/Redis/data-transfer costs |
| Azure | Free-account credits and limited 12-month/Always Free categories, service-dependent | Container Apps/App Service, AKS optional, Azure Database for PostgreSQL, Redis, Key Vault | Strong enterprise managed option | Final production with Azure/.NET/enterprise context | Unexpected managed/database/network costs |
| Google Cloud | Trial credits; selected Always Free usage and region restrictions; Cloud Run cost model | Cloud Run, Cloud SQL, Memorystore, Secret Manager | Strong serverless path for stateless web/API | PWA/API split | Background service and Redis/network complexity; Cold starts |
| Render | Starter paid compute in many cases; managed database add-ons are separate | Managed web, workers, PostgreSQL, Redis/Key Value | Simple managed service | Small team pilot with no VPS operations | Free compute paused/spin-down behavior varies; DB pricing/billing |
| Railway | Usage-based paid plan; resource/egress/disk add-ons | Managed app, PostgreSQL, Redis | Simple, but less enterprise control | Prototyping and paid pilot | Usage surprises; region/HA/privacy features may not fit production |
| Fly.io | Small Machines allowances may exist; managed Postgres and volumes/add-ons separate | Machines, volumes, managed data options | Good global apps; moderate operations | Dockerized app with distributed users | Multi-service limits, volumes, backups, paid IP/egress |
| DigitalOcean | No durable general compute free tier; low-cost droplets/app platform/add-ons | Droplet, App Platform, Managed PostgreSQL/Redis, Spaces | Low-cost managed/VPS | Simple low-operations production | Managed DB and backups cost extra; backup/HA require paid plan |
| Hetzner Cloud | No free tier; low fixed prices | VPS, managed DB/firewall/storage products vary by location | Very low cost production VPS | Cost-sensitive self-managed production | No large free allowance; operations responsibility; regional latency for India |
| Oracle paid ARM/AMD VM | No free tier after limits; low hourly rates in some regions | Same VM model, optionally managed database/storage in paid tiers | Lower-cost production with managed upgrades | If staying on OCI/VPS model | Single-VM HA unless expanded |
| Cloudflare for ingress/DNS | Generous free tier for DNS/Tunnel/WAF categories | DNS, CDN, Zero Trust Tunnel, Pages, Workers | Edge/ingress, not a database runtime replacement | Public ingress and DDoS/WAF protection | Not a secret-free monolith platform; Workers/Pages incompatible with long-lived APIs unless adapted |

### Provider-specific conclusions

- **AWS EC2 + Compose:** recommended for the initial credit-funded pilot because it works without OCI capacity and can run the repository immediately.
- **OCI Always Free:** retain as a possible future cost-optimized fallback, provided capacity and reclamation terms are accepted.
- **AWS managed ECS/RDS:** recommended long term, provided the budget supports a load balancer, RDS PostgreSQL, Redis/managed cache, backups, and observability. ECS avoids Kubernetes while retaining production controls.
- **Azure/GCP:** viable, especially if an organization is already committed to the provider. Compare total monthly cost rather than free-trial credit.
- **Render/Railway/Fly:** good middle ground when time-to-market and operations are more valuable than a few dollars of VM cost. Use only after database backup, private networking, minimum replicas, and scaling limits are verified.
- **DigitalOcean/Hetzner:** good low-cost VPS alternatives, but not the cheapest true managed service. For production, add managed database/automated backup/monitoring rather than putting PostgreSQL and app containers on an unprotected host.

Official references:

- OCI Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- OCI free services: https://www.oracle.com/cloud/free/
- AWS Free Tier: https://aws.amazon.com/free/
- AWS Free Tier FAQ: https://aws.amazon.com/free/free-tier-faqs/
- AWS EC2 pricing and data-transfer/public IPv4 terms: https://aws.amazon.com/ec2/pricing/on-demand/
- AWS RDS PostgreSQL: https://aws.amazon.com/rds/postgresql/pricing/
- AWS Budgets: https://aws.amazon.com/aws-cost-management/aws-budgets/
- Azure free account/services: https://azure.microsoft.com/en-us/pricing/free-services/
- Google Cloud free: https://cloud.google.com/free
- Render pricing: https://render.com/pricing
- Fly.io pricing: https://fly.io/docs/about/pricing/
- Railway pricing: https://railway.com/pricing

## Target architecture

### Pilot topology on one AWS EC2 VM

```text
Internet
  -> Route 53 / Cloudflare DNS and optional Zero Trust Tunnel/TLS
  -> AWS VPC public subnet with restrictive Security Group
  -> EC2 Linux VM (t4g.small/t3.small, 30–40 GB gp3)
  -> Docker Compose
       -> Nginx reverse proxy
       -> login/resident/admin/operator Next.js apps
       -> API Node service
       -> worker (worker is currently health only)
       -> resident-auth service (optional, Better Auth)
       -> PostgreSQL 16
       -> Redis 7

Backups: pg_dump/custom backups uploaded to private S3 with encryption and restore testing
Secrets: AWS SSM Parameter Store/Secrets Manager or protected pilot .env during the first limited launch
CI/CD: GitHub Actions OIDC -> build/push multi-arch/ARM64 images -> GHCR -> SSM/Tailscale -> migrate -> deploy
Observability: uptime probes, Docker health, CloudWatch Logs/Metrics/alarms, AWS Budgets, disk/RAM/CPU alerts
```

Use the public origin names below. Keep operator access private; do not expose `/operator` as an unauthenticated public route.

Recommended domains:

```text
app.example.in       resident web
admin.example.in     admin web
ops.example.in       operator web, private/WAF/Tailscale access
login.example.in     login chooser
api.example.in       API
```

### Final AWS-grade topology

```text
Users
  -> Route 53/DNS -> CloudFront or ALB -> resident/admin/login/operator containers
                             |
                             +-> ECS service: API (2 tasks, private subnets)
                             +-> ECS service: worker (2 tasks only after queue processors exist)
                             +-> ECS service: resident-auth
                             +-> RDS PostgreSQL Multi-AZ
                             +-> ElastiCache Redis or managed Redis
                             +-> S3 private object storage
                             +-> Secrets Manager
                             +-> CloudWatch logs/alarms + backup vault
```

Use Amazon RDS PostgreSQL rather than a PostgreSQL container for production. The worker remains a deployment gate until BullMQ/processor behavior is implemented and tested. Prefer ECS EC2 for predictable low-cost workloads; use ECS Fargate when reducing operations is worth the compute premium.

## Toolchain

| Concern | Pilot | Final production |
|---|---|---|
| Infrastructure as code | EC2 CloudFormation or Terraform | Terraform modules for provider/VPC/ECS/RDS/DNS |
| Images | Build ARM64; push GHCR | Multi-arch or provider-native architecture; GHCR/ECR |
| Deployment | GitHub Actions OIDC/Tailscale | GitHub Actions OIDC + ECS deploy/secret references |
| DNS/TLS | Cloudflare DNS/Tunnel or own certificates | ACM/R53/CloudFront/ALB or provider TLS |
| Secrets | Pilot-protected host env, then AWS Secrets Manager | AWS Secrets Manager/Azure Key Vault/GCP Secret Manager |
| Database | PostgreSQL 16 in Compose | Managed PostgreSQL with Multi-AZ/HA and backups |
| Redis | Redis container on VM | Managed Redis with private networking |
| Backups | Scheduled encrypted dump/upload; test restore | Managed automated backups plus encrypted cross-region/object copies |
| Monitoring | Uptime Robot/Better Stack + Cloudflare + host logs | CloudWatch/Prometheus/Grafana or provider-native |
| Error tracking | Sentry or provider-native | Sentry/provider-native with PII scrubbing |
| Cost control | OCI budget/email alert | Provider budget/billing alerts, quotas, weekly cost review |
| Operator access | Tailscale/Zero Trust/private hostname | IdP-protected private ingress, MFA, audit logs |

## Phased delivery plan

### Phase 0: launch gates — required before any production tenant

1. Complete and approve owner sign-off for payments, support access, data retention, RPO/RTO, custom-domain policy, and backups.
2. Create separate staging and production Auth0 tenants, databases, Resend identities, and domains.
3. Remove all placeholder/unused production defaults and fail closed on missing secrets.
4. Keep `OPERATOR_IDS` and private operator ingress mandatory in production.
5. Implement and verify a complete restore, encrypted backup, migration rollback/forward-fix process, and migration-runner approvals.
6. Implement health checks that distinguish liveness/readiness. Do not expose secrets in health responses.
7. Define the SLA, incident owner, support channel, backup schedule, and cost ceiling.

Exit evidence: signed gate checklist, restore test, load test, security review, and no secrets in Terraform/source/Docker build args.

### Phase 1: AWS EC2 pilot

1. Create an AWS account in `ap-south-1`, but keep its credit and billing protections separate from application resources.
2. Set AWS Budgets for $5, $10, $20, and the approved monthly ceiling; enable billing alerts and cost anomaly detection.
3. Provision one restricted VPC, one subnet, security group, keyless SSM access, and one EC2 instance using CloudFormation/Terraform.
4. Launch `t4g.small` for ARM64 if all container images support it; otherwise launch `t3.small` for AMD64. Start with 30–40 GB gp3 EBS and no unnecessary block volumes.
5. Prefer Cloudflare Tunnel or Tailscale for public ingress. If public IPv4 is required, account for the charge and keep only HTTP/HTTPS exposed.
6. Run migrations before application containers become traffic-ready. Back up PostgreSQL before every migration and upload an encrypted copy to S3.
7. Configure HTTPS origin names, exact Auth0 callback/logout/web origins, CORS, and separate pilot secrets.
8. Add uptime probes for `/v1/health`, `/v1/ready`, and all four web health paths.
9. Add disk/RAM/CPU, CloudWatch log, AWS billing, and S3 backup alerts.
10. Deploy through GitHub Actions with immutable image digests and health verification; automatically stop traffic or roll back failed application releases.

Exit evidence: HTTPS smoke test, database migration, backup restore, worker/queue not falsely exposed as complete, zero exposed admin secrets, and documented capacity/cost.

### Phase 2: limited pilot with real communities

1. Start one or two approved communities only.
2. Verify invitation delivery, Auth0 OTP, RLS isolation, offline payment reporting, complaints/photos, billing, and organization deletion.
3. Enable photo storage only if private S3/R2/CORS/lifecycle/cleanup are implemented and tested.
4. Monitor CPU/RAM/disk, connection counts, queue latency, API latency, backups, and error rates.
5. Enforce operator private ingress and audited support access.
6. Add a spending ceiling and operational escalation thresholds.

Exit criteria: at least 30 days of stable operation, successful restore rehearsal, acceptable latency, and all critical production gates closed.

### Phase 3: production cutover

1. Freeze the functional scope and launch inventory; keep payment/checkout disabled until its provider gate is implemented.
2. Provision managed PostgreSQL, Redis, private network, TLS, secrets, object storage, and backups.
3. Deploy application services with at least two API replicas for a separate failure domain and one worker only after real processors exist.
4. Run schema migrations in a controlled job before application rollout; keep forward-fix procedures documented.
5. Move DNS with a low TTL, then run a staged canary and rollback check.
6. Re-run security, RLS, backups, load, and Auth0 callback tests against production names.
7. Retain the pilot for rollback for a defined window, then shut down only after data consistency is verified.

Exit evidence: production smoke suite passes, backups are restorable, two-region/off-site recovery target is met or owner accepts shorter coverage, and ownership is transferred from deployer to an operations owner.

### Phase 4: scale only when metrics require it

Scale triggers should be measured, not assumed:

- Add API replicas before vertical CPU alone no longer improves latency.
- Add worker replicas only after queue depth and processor behavior are implemented.
- Move to managed Redis/PostgreSQL and split read/analytical workloads only when connection/latency pressure proves it.
- Add CDN/cache/WAF when public traffic or abuse patterns justify cost.
- Consider a second region only after RTO/RPO, data residency, and failover testing have owners.
- Do not introduce Kubernetes unless there are at least several independent services, sustained multi-team operations, and a skills budget.

## Environment matrix

| Environment | AWS resource | Data | Auth/email |
|---|---|---|---|
| Local | Docker Compose | Disposable PostgreSQL/Redis | Non-production Auth0, dev Resend |
| Staging | Small managed/VM environment | Separate DB, synthetic data | Separate Auth0 tenant/app, sandbox email |
| Pilot | EC2 + Docker Compose | Pilot PostgreSQL/Redis with tested encrypted backups | Pilot Auth0 tenant, verified sender |
| Production | ECS/RDS or equivalent paid managed topology | Production platform + tenant databases | Production Auth0 tenant, production sender |

Staging must exercise migrations, backups, worker behavior, CORS, callbacks, private operator ingress, and private object storage; synthetic data only.

## CI/CD and migration sequence

Recommended GitHub Actions deployment order:

1. `platform:validate`
2. `pnpm typecheck`, lint, test, build
3. Database-backed test suite
4. Build and attest ARM64/AMD64 image digests
5. Push immutable GHCR/ECR images
6. Retain migration lock and run `scripts/run-migrations.sh` for platform and tenant databases
7. Deploy API, resident-auth and web services
8. Run readiness and smoke checks
9. Roll back application images if smoke checks fail; use forward SQL fixes for schema incompatibility

Do not deploy migrations and application changes concurrently without a compatibility window. A single migration failure must stop deployment and preserve the pre-migration backup.

## Cost model and budget gates

Potential pilot recurring items are not all visible in the EC2 VM line:

- Public IP/reserved-IP allocation if changed from the current ephemeral model
- Load balancer, extra block storage, paid snapshots, managed database, object storage, egress, support
- Cloudflare/Zero Trust paid add-ons
- Auth0 tenant/MAU pricing
- Resend sending volume and verified domain
- Email/OTP, S3/R2, monitoring, error tracking, backups and logs
- Domain registration/TLS and paid certificate services

Before provisioning:

1. Set a monthly budget and alert at 50%, 80%, and 100% of the ceiling.
2. Create a provider cost budget/quota independent of Terraform.
3. Revisit provider pricing on the same day before every paid resource is created.
4. Track actual monthly unit cost per community and per active resident.
5. Reserve 20–30% budget headroom for traffic, backups, and support incidents.

## EC2 pilot versus ECS production recommendation

EC2 Compose is the better **credit-funded pilot platform**:

- It can run the existing repository topology without waiting for OCI capacity or redesigning for ECS.
- It has less service configuration than ECS, Fargate, ALB, NAT, and RDS for an initial limited launch.
- Its credit cost should be reviewed frequently; a public IPv4, snapshots, S3 storage, logs, or unexpected services can consume the allowance.

ECS is the better **final production platform**, not the better zero-cost pilot:

- ECS provides task isolation, rolling deployment, service discovery, IAM task roles, capacity scaling, and integration with RDS/ALB/Secrets Manager.
- ECS still requires EC2/Fargate compute, potentially an ALB, NAT/egress, RDS, logging/backup, and Redis.
- AWS does not offer perpetual free ECS compute for this workload; promotions and account credits are time-limited.

Therefore: **AWS EC2 + Compose pilot first, ECS/RDS managed production after pilot economics and product gates are proven**.

## Immediate implementation priorities

1. Do not deploy directly from `.env`; provision staging and pilot secrets separately.
2. Create pilot EC2/VPC Terraform or CloudFormation; keep credentials and Terraform state private.
3. Add a production Compose image-only deployment file; keep local source-build Compose separate.
4. Add GitHub Actions build/deploy workflow and smoke verification.
5. Add managed/backed-up PostgreSQL for production even if pilot PostgreSQL stays in Compose.
6. Add uptime, log, backup, disk, CPU, memory, and cost alerts before pilot launch.
7. Complete the production gates documented in `docs/security-and-ops.md`.
8. At 30–100 real active residents, review ECS/RDS/Fargate versus managed VPS based on measured CPU, connections, availability, and monthly bills.

See also [architecture.md](architecture.md), [security-and-ops.md](security-and-ops.md), [shared-database-operations.md](shared-database-operations.md), and [local-setup.md](local-setup.md).
