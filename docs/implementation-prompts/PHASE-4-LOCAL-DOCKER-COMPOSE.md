# Phase 4 — complete local runtime with Docker Compose

Read [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), the prior phase results, and
the local/staging environment rules in
[`../architecture/security-and-production-deployment.md`](../architecture/security-and-production-deployment.md).
Implement and verify this in the repository. The outcome is a reproducible
local environment for exercising the first-party product from a browser and
API client, not a production deployment.

## Goal

Run the Nivasa UI surfaces, API, worker, and local data/queue infrastructure
through Docker Compose. Auth0, Resend, Firebase, and Filebase stay external
and use local `.env` configuration. Do not containerize, emulate, or replace
those provider services with runtime fakes.

## Compose stack

Provide Compose services for:

- PostgreSQL with `platform_db`, local tenant-database provisioning support,
  persistent local-only volume, startup healthcheck, and safe migration
  initialization.
- Redis with persistence only if needed by the queue semantics, healthcheck,
  and local-only exposed port.
- API and worker as separate containers using the same built workspace and
  runtime configuration, with readiness/health checks and graceful shutdown.
- Admin web and separate operator web. Keep the operator's production network
  ingress policy distinct; local browser access is explicitly development-only.
- Flutter resident client in a browser-runnable web target if supported by the
  application, while retaining the Flutter mobile application as the
  canonical resident client. Provide documented local device/emulator
  connection instructions if mobile builds cannot run inside Compose.

Use service DNS names inside the Compose network, not `localhost`, for
container-to-container URLs. Expose only the local ports needed by a developer.
Use health-based dependency conditions where supported. Avoid privileged
containers and broad host mounts; only mount source/config needed for local
development, never the Docker socket or home directory.

## External provider configuration

- Load secrets from an ignored repository-root `.env` file using Compose
  environment interpolation or `env_file`; keep only non-secret placeholder
  variable names and safe example values in `.env.example`.
- Support Auth0 issuer/domain, API audience, application client IDs/callback
  configuration, and Auth0 email OTP. Auth0 remains the identity authority;
  local auth must not bypass it or inject demo identities.
- Support Resend transactional email configuration and Firebase FCM
  server-side credentials/configuration; support Filebase S3-compatible
  endpoint, bucket, region, and server-only credentials.
- Do not put private Auth0, Resend, Firebase service-account, Filebase, or
  payment credentials in Dockerfiles, build args, source maps, frontend
  bundles, Compose output, or logs. Public Firebase client configuration, if
  needed by the client SDK, must be deliberately separated from server
  credentials.
- External provider URLs remain external; do not add Auth0, Resend, Firebase,
  Filebase, or payment-gateway containers.
- Clearly define which integrations are required to start and which are
  optional. An intentionally disabled integration must be visibly identified
  as unavailable; incomplete credentials must produce a clear configuration
  error. Never silently substitute a fake adapter or success response.
- Ensure `.env` cannot be committed and include a safe `.env.example` with
  all variables required by Compose, descriptions/defaults, and no live keys.
  Never use production credentials in local development.

## Developer workflow and documentation

- Document prerequisites, setup, build, launch, health checks, URLs, logs,
  migration/seed behavior, external Auth0 callback URLs, `.env` setup, and
  clean shutdown using commands such as:

  ```sh
  cp .env.example .env
  docker compose config
  docker compose up --build
  docker compose ps
  docker compose down
  ```

- Provide deterministic development seed data only for non-sensitive tenant
  structures if useful; label it development-only, make it opt-in or
  repeatable, never seed production-like personal/payment data, and never
  create demo authentication bypasses.
- Add startup scripts/healthchecks that wait for dependencies, apply only
  forward migrations, and report failures. Do not silently reset or erase
  database volumes. Document any explicit destructive local reset command
  separately, with a warning and precise target volume.
- Make local API/web/mobile client base URLs work both from Compose containers
  and from a developer's browser or emulator. Avoid embedding secrets into
  client code at build time.
- Add `.dockerignore` files to exclude `.env`, credentials, Git metadata,
  dependencies, generated artifacts, and unrelated files from build contexts.
  Build reproducible, appropriately minimal images using non-root runtime
  users where feasible.
- Explain that successful local Compose execution does not certify staging
  or production, and that production-only private-ingress rules still apply.

## Required tests and phase exit criteria

- Validate Compose syntax with `docker compose config`; build all application
  images and start the stack from a clean local setup.
- Verify every expected container becomes healthy, web UIs load, API
  readiness/OpenAPI endpoints respond, and worker connects to Redis and
  processes a safe test job. Verify tenant migrations and a tenant-scoped
  workflow run against PostgreSQL.
- Verify Auth0 login can be completed with the configured non-production
  tenant. Verify configured Resend, Firebase, and Filebase integrations use
  their external services only; when credentials are absent, confirm the
  documented disabled/error behavior and no fake success.
- Check container configuration, built frontend assets, logs, and image
  contents for leaked secrets. Confirm `.env` is ignored and absent from image
  layers/build context.
- Test restart behavior, dependency-unavailable behavior, migration failure,
  and clean shutdown without data loss. Run repository type-check, lint,
  tests, and build.
- Report exact startup commands, URLs, health/test results, required local
  credentials/callback setup, limitations (including Flutter mobile), and
  unresolved approval gates. Do not start Phase 5 cloud deployment or apply
  infrastructure in this phase.
