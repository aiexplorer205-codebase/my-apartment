# Private photo storage and retention

Complaint photos now use private S3-compatible storage. There are no other
implemented photo file inputs; resident CSV import remains an application CSV
flow. Shared browser compression and the storage port can support future image
features, but each must add its own entity/role authorization before enabling an
upload endpoint. No worker job processor or push service was added.

## Implemented flow

1. The browser inspects JPEG/PNG/WebP dimensions before decoding, rejects inputs
   above 5 MiB or 20 megapixels, and compresses to a metadata-free WebP of at most
   1600 pixels per side and 1 MiB. Unsupported WebP encoders fail visibly.
2. The authenticated resident requests an upload intent with name, compressed
   size, SHA-256, and an idempotency key. The API resolves active membership; it
   never accepts a bucket/key/URL from the client. Daily rolling quotas are 30
   reservations per resident and 1,000 per tenant, with tenant-serialized checks.
3. The API signs a five-minute PUT to `staging/<tenant>/complaints/<uuid>.webp`.
   Content length/type and checksum metadata are signed. The browser PUTs directly
   to storage without Auth0 cookies or tokens. This is a private staging object,
   not a viewable complaint attachment.
4. Completion checks ownership, a 15-minute intent deadline, and a two-minute
   validation lease. The server reads at most 1 MiB, verifies actual SHA-256/size,
   rejects non-WebP, animation, malformed data, and excess decoded pixels, then
   re-encodes WebP without metadata. There are at most two simultaneous image
   validations per API process. Each storage request has a bounded timeout.
5. The sanitized object is written to a NEW server-generated key under
   `media/retention-90d/<tenant>/complaints/<upload>/<attempt>.webp`. Every candidate
   is recorded before writing for crash-safe cleanup. Replaying a PUT URL cannot
   modify the sanitized object. Failed finalizations can be retried.
6. Complaint creation accepts up to three verified upload UUIDs. Ownership,
   availability, expiry, and single attachment are checked under row locks in the
   complaint transaction. Complaint/attachment metadata commit atomically. A lost
   response can be retried with the same complaint request key and upload IDs.
7. Viewing checks current tenant/role and resident ownership, then returns a
   signed GET valid for at most 60 seconds and never beyond the recorded expiry.
   Image bodies bypass Next.js/API. Responses and stored images use
   `private, no-store`; the image element suppresses referrer headers. Signed URLs
   are bearer capabilities: do not log, persist, or put them into analytics.

The API records metadata/keys, not image binaries. Migration tenant `037` removes
binary storage. It is intended for this project's empty-data rollout and does
not infer a migration of existing customer photos. Platform `010` records durable
external-cleanup requests. Use the normal migration runner and rebuild API.

## Retention: 90 days

`PHOTO_RETENTION_DAYS=90` is the chosen default. Expiry starts at finalization.
Supported settings are 30, 90, 180 and 365; each object retains its original
policy prefix/expiry if the environment changes later.

- Private staged objects: bucket lifecycle expiration after one day.
- Unattached verified uploads and failed validation candidates: periodic cleanup
  after one day. Failed compensation does not hide candidate keys from cleanup.
- Attached images: access denied at the recorded 90-day expiry; object cleanup
  and bucket lifecycle remove the bytes. Complaint text and expired-photo
  metadata remain, and the UI explains why the image is no longer available.
- Bucket expiration is asynchronous, so do not promise deletion at an exact
  second. API expiry prevents new authorized reads immediately at expiry. A
  previously downloaded image cannot be revoked from a user's device.
- Tenant deletion blocks access, purges tenant rows, then deletes tenant-specific
  staging/final prefixes. An outbox survives partial failure. Outstanding PUT
  capabilities may recreate a staging object for up to five minutes; these cannot
  be finalized after the deletion tombstone and expire via staging lifecycle.

Do not promise legal holds: R2's S3 compatibility differs from AWS S3. This
implementation requires a dedicated, non-versioned media bucket and refuses
versioned S3 buckets in the policy tool. Review a separate storage design if
immutable retention, legal hold, or versioned backups become requirements.
[Cloudflare lifecycle documentation](https://developers.cloudflare.com/r2/buckets/object-lifecycles/),
[S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Deployment

Create a dedicated private bucket per environment. Disable R2 public access
(including `r2.dev` and public custom domains) in the Cloudflare console. For AWS
S3, enable Block Public Access. Use encryption at rest provided by your storage
service and HTTPS endpoints. Do not put backups and short-lived media into one
bucket. Do not enable a CDN/public URL for private photos.

Runtime environment (server only):

```dotenv
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=myapartment-private-photos
S3_ACCESS_KEY_ID=<bucket-scoped-runtime-access-key>
S3_SECRET_ACCESS_KEY=<runtime-secret>
S3_FORCE_PATH_STYLE=false
PHOTO_RETENTION_DAYS=90
```

For AWS S3, use the real AWS region, omit `S3_ENDPOINT`, and prefer workload IAM
credentials over static keys. Compatible endpoints may need
`S3_FORCE_PATH_STYLE=true`. HTTP endpoints are allowed only for loopback/local
integration tests, never production. Keep a bucket/endpoint stable for existing
photos; moving providers requires copying objects and a deliberate cutover.

The runtime principal needs GetObject/PutObject/DeleteObject and ListBucket only
for the bucket's `staging/` and `media/` prefixes. It does not need bucket policy,
CORS, lifecycle, ACL, or bucket creation permissions. Restrict ListBucket prefixes
where supported. Use independent bucket-administrator credentials for setup.
Provider API tokens and server secrets must never enter `NEXT_PUBLIC_*`.

Generate and review bucket policy without making remote changes:

```sh
S3_PROVIDER=r2 S3_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com \
  node scripts/configure-photo-storage.mjs
```

With deployment secrets supplied securely (`S3_ADMIN_ACCESS_KEY_ID` and
`S3_ADMIN_SECRET_ACCESS_KEY`, or an appropriate AWS credential chain):

```sh
node scripts/configure-photo-storage.mjs --apply
node scripts/configure-photo-storage.mjs --check
scripts/run-migrations.sh platform
scripts/run-migrations.sh tenant
docker compose up --build -d --no-deps api
```

Set `S3_PROVIDER=r2` for R2, `s3` for AWS, or `compatible` for another service.
The tool installs prefix lifecycle rules and exact-origin CORS, preserves safe
unrelated rules, rejects conflicting lifecycle/broad CORS rules, and blocks public
access for AWS S3. Other providers require their own public-access verification.
No bucket is created automatically and no deployment settings have been applied
to your live accounts as part of implementation.

CORS permits GET/PUT/HEAD from the exact resident/admin origins, headers
`content-type` and `x-amz-meta-sha256`, and exposes ETag. Browser-supplied content
length is signed but cannot be manually set by JavaScript. Do not change the
presigned endpoint host; the signature covers it. Test uploads on the actual
production origin, not just curl.

## Periodic cleanup

Install the provided systemd service/timer on the deployment host after adjusting
`User`, `WorkingDirectory`, and Docker path for that host:

```sh
sudo install -m 644 infrastructure/systemd/myapartment-photo-cleanup.service /etc/systemd/system/
sudo install -m 644 infrastructure/systemd/myapartment-photo-cleanup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now myapartment-photo-cleanup.timer
sudo systemctl start myapartment-photo-cleanup.service
```

Equivalent managed cron is fine. The command is:

```sh
docker compose run --rm --no-deps api node apps/api/dist/apps/api/src/photo-maintenance-cli.js
```

Each run processes bounded batches per community and resumes purged-tenant
storage deletions. Runs are retry-safe. A failed run exits nonzero and logs only
counts/status, not resident details, keys, signed URLs or credentials. Alert on
nonzero exit, stale successful runs, upload/validation errors and storage quota
usage. Lifecycle rules remain the fallback if the application scheduler is down.

Monitor aggregate bucket usage and request counts across tenants. Quotas and
compression reduce abuse but do not guarantee a zero bill; provider budget and
capacity decisions remain deployment responsibilities.

## Backup and verification

SQL backups/export now contain object references. Back up/copy objects separately
when recovery requires them; use manifests and preserve object keys. A SQL restore
does not restore deleted photos. Copies, versions and external backups must have
an approved retention/deletion policy too; do not silently retain expired media
forever. Do not restore old references into serving state past their original
expiry. See [shared database operations](./shared-database-operations.md).

Run `bash scripts/test-database.sh` for all tests, including the pinned S3 HTTP
emulator. It is test infrastructure, not a production storage recommendation.
Tests cover compression, image validation, signed headers/TTL, HTTP object I/O,
RLS/ownership, retries, atomic attachment, expiry, and cleanup. The emulator does
not prove a live provider's signature enforcement, IAM, TLS, public-access state,
CORS behavior in a real browser, or actual lifecycle deletion timing. Before
onboarding, verify those settings on your real R2/S3 bucket and exercise a timed
expiry/cleanup and backup restore using non-customer fixtures.
