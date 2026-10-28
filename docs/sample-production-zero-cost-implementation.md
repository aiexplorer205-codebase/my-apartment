MyApartment by Block9: Zero-Cost Production Runbook
Next.js multi-tenant PWA on free tiers: Cloudflare + Oracle Always Free VM + R2 + Auth0 + Resend. Assumes Postgres; adjust if your DB or ORM differs. Free-tier limits change, so re-check each pricing page before launch. Replace yourdomain.com and YOUR_GH_USER everywhere.
1. Architecture at a glance
Residents / Admins (PWA)
        |
        v
Cloudflare  (DNS, CDN, WAF, Turnstile)            free
        |  outbound-only encrypted tunnel (no open ports)
        v
Oracle Always Free ARM VM (Hyderabad)
  |-- cloudflared   tunnel connector
  |-- app           Next.js (standalone build)
  |-- worker        scheduler + notification queue (pg-boss)
  |-- db            Postgres 16

Side services
  Auth0 .......... login + passkeys (custom domain auth.yourdomain.com)
  Cloudflare R2 .. complaint and task-proof photos (private bucket)
  Resend ......... email (100/day cap), Brevo as overflow
  Web Push ....... VAPID, sent from the worker
  Backups ........ nightly pg_dump -> R2 -> weekly copy to AWS S3 (your $100 credit)
Layer
Provider
Free allowance to remember
Edge, DNS, WAF
Cloudflare
Free plan, commercial use allowed
Compute + DB
Oracle Always Free ARM
2 OCPU / 12 GB RAM
Files
Cloudflare R2
10 GB, 1M writes + 10M reads per month, no egress fee
Auth
Auth0
25,000 MAU, custom domain, passkeys
Email
Resend
3,000/month, max 100/day
Backup copy
AWS S3
Paid from your $100 credit
CI/CD
GitHub Actions + GHCR
Free allowance for private repos
2. Five-day plan
Day
Do
1
Domain on Cloudflare, Oracle account + VM, Tailscale
2
Harden server, Docker, compose file, Postgres up
3
Tunnel, image build via CI, app live on https
4
R2 uploads, Auth0 production tenant, Resend domain, web push
5
Backups + restore test, monitoring, security checklist, pilot invite
3. Accounts you need
Domain (any registrar, nameservers moved to Cloudflare), Cloudflare, Oracle Cloud (card needed for verification), GitHub, Auth0 (new production tenant), Resend, AWS (existing), Tailscale (free personal plan). Keep every secret in a password manager.
4. Cloudflare setup
1. Add your domain, switch nameservers at the registrar, wait for Active.
2. SSL/TLS: Always Use HTTPS on. Turn HSTS on only after everything works.
3. Cache Rules: cache everything for /_next/static/* (edge TTL 1 month); bypass cache for /api/* and /auth/*. Make sure your service worker file is served with Cache-Control: no-cache so PWA updates reach users.
4. Security: enable the free managed WAF rules, add a rate-limit rule for login/signup/re-link paths (free plan rule counts are limited, check current numbers), and add Turnstile to the QR signup and re-link forms.
5. DNS records for Auth0 (auth) and Resend (SPF, DKIM, DMARC) must be DNS only (grey cloud), not proxied.
5. Oracle VM
1. Sign up at cloud.oracle.com. Choose Hyderabad (ap-hyderabad-1) as home region. It cannot be changed later. Mumbai is the fallback if Hyderabad has no ARM capacity.
2. Compute > Create instance: image Ubuntu 24.04 (aarch64), shape VM.Standard.A1.Flex with 2 OCPU / 12 GB, boot volume about 100 GB (stay inside the Always Free storage allowance), public IPv4 attached, your SSH public key.
3. "Out of host capacity" is common. Retry at off-peak hours, or loop with the OCI CLI. Many people report that upgrading to Pay-As-You-Go fixes capacity.
4. Upgrade to Pay-As-You-Go anyway and set a budget alert of $1. You stay at $0 inside free limits, and as far as I know it removes the idle-reclaim risk. Verify this in Oracle's current docs.
5. Networking: you need no inbound ports for the app (the tunnel is outbound). After Tailscale works, remove port 22 from the VCN security list.
6. Harden the server
sudo apt update && sudo apt -y upgrade
sudo adduser deploy && sudo usermod -aG sudo deploy
# add your key to /home/deploy/.ssh/authorized_keys, test login, then:
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
sudo apt -y install fail2ban unattended-upgrades curl age rclone

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy

# Tailscale (private admin access + CI deploys, SSH keys not needed)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
Limit Docker logs so the disk never fills: put {"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}} in /etc/docker/daemon.json and run sudo systemctl restart docker. Oracle's Ubuntu image ships restrictive iptables rules. Since you open nothing, leave them as they are and skip ufw to avoid conflicts. Keep the server and database in UTC. Convert to IST in the app.
7. Build the image
In next.config.js set output: 'standalone'. Add /api/health that returns 200 only if a SELECT 1 succeeds.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD node server.js
The standalone image has no dev dependencies, so run DB migrations from a separate migrate target built from the build stage, executed once per deploy (docker compose run --rm migrate).
8. docker-compose and environment
Create /opt/myapartment/docker-compose.yml:
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${PGUSER}
      POSTGRES_PASSWORD: ${PGPASSWORD}
      POSTGRES_DB: ${PGDATABASE}
    command: postgres -c shared_buffers=1GB -c effective_cache_size=4GB -c work_mem=16MB -c max_connections=100
    volumes:
      - pgdata:/var/lib/postgresql/data
    mem_limit: 3g
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB']
      interval: 10s
      retries: 5

  app:
    image: ghcr.io/YOUR_GH_USER/myapartment:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    mem_limit: 2g
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/api/health || exit 1']
      interval: 30s
      retries: 3

  worker:
    image: ghcr.io/YOUR_GH_USER/myapartment:latest
    restart: unless-stopped
    env_file: .env
    command: node worker.js
    depends_on:
      db:
        condition: service_healthy
    mem_limit: 512m

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}

volumes:
  pgdata:
The database publishes no port, so it is reachable only from other containers. Create .env next to it and run chmod 600 .env. Never commit it.
PGUSER=myapartment
PGPASSWORD=<openssl rand -hex 24>
PGDATABASE=myapartment
DATABASE_URL=postgres://myapartment:<password>@db:5432/myapartment
APP_BASE_URL=https://app.yourdomain.com
AUTH0_DOMAIN=auth.yourdomain.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=<openssl rand -hex 32>
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=myapartment-files
RESEND_API_KEY=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@yourdomain.com
TUNNEL_TOKEN=...
If your GHCR package is private, run docker login ghcr.io once on the VM with a token that has read:packages.
9. Cloudflare Tunnel
1. Cloudflare dashboard > Zero Trust (it may ask for a card on file, free plan is $0) > Networks > Tunnels > Create tunnel > Cloudflared.
2. Copy the token into TUNNEL_TOKEN in .env.
3. Add a public hostname: app.yourdomain.com > HTTP > app:3000.
4. docker compose up -d, then open https://app.yourdomain.com.
Because DNS points at the tunnel and not at an IP, you can move the connector to any server later without touching DNS.
10. CI/CD (GitHub Actions)
.github/workflows/deploy.yml:
name: deploy
on:
  push:
    branches: [main]
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/arm64
          push: true
          tags: ghcr.io/${{ github.repository }}:latest,ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - uses: tailscale/github-action@v3
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
          oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
          tags: tag:ci
      - run: ssh deploy@myapartment-vm 'cd /opt/myapartment && docker compose pull && docker compose run --rm migrate && docker compose up -d && docker image prune -f'
Create a Tailscale OAuth client with tag tag:ci, allow that tag to SSH to the VM in your tailnet ACLs, and use the VM's tailnet name. No SSH key is stored in GitHub. Pin action versions to what is current when you set this up. QEMU arm64 builds are slow. If the repo is public you can use GitHub's native arm runner for faster builds.
11. Cloudflare R2 (photos)
1. R2 > Create bucket myapartment-files (APAC location hint), keep it private.
2. Create an API token with Object Read and Write limited to that bucket. Save the keys in .env.
3. Bucket CORS (needed for direct browser uploads):
[{"AllowedOrigins":["https://app.yourdomain.com"],"AllowedMethods":["GET","PUT"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]
4. In the app use @aws-sdk/client-s3 with @aws-sdk/s3-request-presigner: endpoint https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com, region auto.
5. Flow: the API checks the user's community and role, then returns a presigned PUT (5 minutes). The browser uploads straight to R2. To show a photo, the API authorizes and returns a short-lived presigned GET.
6. Object keys: {tenantId}/complaints/{uuid}.webp and {tenantId}/tasks/{uuid}.webp. Tenant-prefixed keys make per-community export and deletion easy.
7. Compress on the device before upload: resize to about 1280 px wide, WebP at roughly 0.75 quality. That is typically a few hundred KB per photo, so 10 GB holds tens of thousands of photos.
12. Auth0 (production)
1. Create a separate production tenant. Keep the dev tenant small, since its users count separately.
2. Custom domain first: Settings > Custom Domains > auth.yourdomain.com, add the CNAME as DNS only, verify. Passkeys are bound to the domain, so set this before any resident enrolls. Changing it later would invalidate passkeys.
3. Application: Regular Web Application. Allowed Callback URLs https://app.yourdomain.com/auth/callback (/api/auth/callback on SDK v3), Allowed Logout URLs https://app.yourdomain.com.
4. Enable passkeys on the database connection, and email OTP as per your resident auth spec.
5. Set Resend as Auth0's email provider (SMTP) before launch. Auth0's built-in sender is for testing only. These emails count toward the Resend 100/day cap.
6. Keep communities, roles, devices and the audit log in your own DB keyed by Auth0 sub. Do not use Auth0 Organizations, since the free plan allows only 5.
13. Email, web push, scheduler
• Resend: add and verify yourdomain.com, send from notify@yourdomain.com. Priority order inside the worker: OTP > admin alerts > everything else. Count sends per day, stop at about 90, push the rest to tomorrow. Brevo (300/day free) is the overflow option.
• Web push: npx web-push generate-vapid-keys, store one subscription per device. Android Chrome works well. iOS needs the PWA installed to the home screen, so keep an in-app notification inbox as the fallback.
• Scheduler: run pg-boss in the worker container. It is Postgres-backed, so no Redis is needed. Schedule recurring cleaning and maintenance tasks with cron expressions in Asia/Kolkata. Jobs: create task occurrences, notify residents on completion with the proof photo, daily digest.
14. Backups and restore
One-time: age-keygen -o key.txt. Store key.txt offline in your password manager and put only the public key on the server. Add an r2 remote to rclone (type s3, provider Cloudflare, endpoint https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com) and an s3 remote for AWS with an IAM user limited to one bucket.
/opt/myapartment/backup.sh:
#!/usr/bin/env bash
set -euo pipefail
source /opt/myapartment/.env
TS=$(date -u +%Y%m%dT%H%M%SZ)
cd /opt/myapartment
docker compose exec -T db pg_dump -U $PGUSER -Fc $PGDATABASE | age -r $AGE_PUBLIC_KEY | rclone rcat r2:myapartment-backups/db/$TS.dump.age
rclone delete r2:myapartment-backups/db --min-age 30d
Add AGE_PUBLIC_KEY= to .env, create a second private R2 bucket myapartment-backups, chmod +x backup.sh, then add to crontab:
0 21 * * *  /opt/myapartment/backup.sh
0 22 * * 0  rclone sync r2:myapartment-backups s3:YOUR-AWS-BUCKET/backups && rclone sync r2:myapartment-files s3:YOUR-AWS-BUCKET/files
21:00 UTC is 02:30 IST. Set an S3 lifecycle rule to expire old objects and an AWS Budget alert so the credit is never a surprise.
Restore test (do it monthly, an untested backup is not a backup):
rclone copyto r2:myapartment-backups/db/<latest>.dump.age /tmp/r.age
age -d -i key.txt /tmp/r.age > /tmp/r.dump
docker run -d --name restore-test -e POSTGRES_PASSWORD=x postgres:16-alpine
docker cp /tmp/r.dump restore-test:/r.dump
docker exec restore-test sh -c 'createdb -U postgres t && pg_restore -U postgres -d t /r.dump && psql -U postgres -d t -c "select count(*) from information_schema.tables"'
docker rm -f restore-test && shred -u /tmp/r.dump /tmp/r.age
15. Monitoring
• /api/health checks DB connectivity. Compose healthchecks restart unhealthy containers.
• Outside-in uptime: use a free uptime monitor (check its current terms and limits for commercial use), or run a small cron on a GCP e2-micro (free in US regions) that calls curl -fsS https://app.yourdomain.com/api/health || curl -d down ntfy.sh/your-secret-topic. Monitoring from a different provider means an Oracle outage cannot hide itself.
• Disk alert: a cron that pings the same ntfy topic when df shows over 80%.
• Sentry free tier for app errors (check current limits). Cloudflare Analytics is free for traffic.
16. Security checklist
[ ] No inbound ports; SSH only over Tailscale
[ ] Password SSH and root login disabled, fail2ban on
[ ] .env is mode 600 and not in git; secrets live in a password manager
[ ] Database not published to any host port
[ ] R2 buckets private; all photo access via presigned URLs after an authorization check
[ ] Every query scoped by tenant ID (multi-tenant leak is the biggest app risk)
[ ] WAF managed rules on, rate limit on login/signup/re-link, Turnstile on public forms
[ ] Security headers set in Next.js (CSP, HSTS, X-Content-Type-Options, Referrer-Policy)
[ ] Audit log records admin re-links, as in your resident auth spec
[ ] Unattended security upgrades on; reboot monthly
17. Limits to watch and when to upgrade
Service
Limit
Watch for
When it bites
Oracle ARM
2 OCPU / 12 GB
Idle reclaim, capacity
Move to a small paid VPS (a few euros a month), same compose file
R2
10 GB
Alert at 8 GB
Compress more, purge old photos, or pay about $0.015/GB
Auth0
25k MAU, 5 Orgs
MAU growth
First paid tier is steep (about $35/month at the time of writing); keep auth behind standard OIDC so you can switch
Resend
100/day
Daily counter
$20/month for 50,000, or move bulk mail to SES/Brevo
AWS credit
$100
Budget alert
Only backups and tests should draw on it
GitHub Actions
Monthly minutes
Slow arm64 builds
Cache layers, or use native arm runners
When the first community starts paying, the first costs will likely be Resend ($20) and a standby VPS. Both are small next to the revenue.
18. Disaster recovery (target: back online in about 1 hour)
1. Create a new VM (Oracle, or any VPS with Docker). Install Docker and Tailscale.
2. Copy docker-compose.yml from git and .env from your password manager.
3. docker compose up -d db, then restore the latest dump (same steps as the restore test, into the real DB).
4. docker compose up -d. The same TUNNEL_TOKEN reconnects, so DNS and Cloudflare settings stay unchanged.
5. Photos are untouched in R2. Check the weekly S3 copy only if R2 itself is lost.
19. Launch checklist
[ ] Domain live on Cloudflare, app opens on https
[ ] Auth0 production tenant with custom domain, passkey signup and re-link tested on a real Android phone
[ ] Photo upload, view, and tenant isolation tested
[ ] Resend domain verified, test OTP delivered to Gmail and an Indian ISP address
[ ] Web push received on Android and on installed iOS PWA
[ ] Scheduler fires a recurring task and the completion push arrives
[ ] First backup visible in R2, restore test passed
[ ] Uptime alert tested by stopping the app on purpose
[ ] AWS budget alert and Oracle $1 budget alert set
[ ] Pilot community invited via admin QR