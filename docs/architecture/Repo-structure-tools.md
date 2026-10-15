# Repo structure and highlevel implementation guidelines

## 1\. Project Overview

Build a multi-tenant Micro-SaaS platform using a pnpm + Turborepo monorepo.

The initial release uses separate Next.js applications for Resident, Tenant Admin, and Platform Operator experiences, a shared Resident/Admin login entry point, one modular backend API, and one background Worker.

Auth0 is the identity provider. PostgreSQL is the primary database. Docker Compose orchestrates the applications during development and the initial deployment.

The architecture must remain simple initially while preserving clear boundaries for potential future microservices and mobile applications.

### Core Requirements

- Use pnpm workspaces and Turborepo.
- Use Next.js App Router and TypeScript for web applications.
- Use Auth0 for authentication, OIDC, MFA, and identity management.
- Keep Resident and Tenant Admin on a shared public login flow.
- Keep Platform Operator authentication separate from the public login flow.
- Enforce tenant isolation and authorization in the backend.
- Use one modular monolith API and one Worker initially.
- Use PostgreSQL as the primary database.
- Use Docker Compose for local development and initial deployment.
- Support responsive web interfaces and Progressive Web App capabilities where appropriate.
- Design API contracts for future React Native / Expo mobile applications.
- Avoid premature microservice decomposition.

## 2\. User Types and Authorization Model

The platform has three primary user types.

### Resident

- Belongs to a specific tenant through a membership.
- Can access resident-specific functionality only.
- Can view or modify only resources authorized for that resident.
- Cannot access Tenant Admin or Platform Operator functionality.

### Tenant Admin

- Is invited by a Platform Operator to administer one specific tenant.
- Receives the `TENANT_ADMIN` role for that tenant only.
- Can invite Residents to that tenant.
- Can manage tenant-specific users, settings, and resources according to permissions.
- Cannot administer other tenants unless explicitly granted separate memberships and permissions.
- Cannot access Platform Operator functionality.

### Platform Operator

- Is an internal platform staff member, not a public tenant user.
- Uses a separate Operator login entry point and authentication policy.
- Can perform platform-level operations according to explicitly assigned permissions.
- Can create tenants and invite Tenant Admins.
- Can monitor jobs, review audit logs, and perform authorized support operations.
- Must use MFA and stronger access controls.
- Must not receive unrestricted database access through the application.
- Must have sensitive actions audited.

Never treat a user as authorized merely because they have authenticated with Auth0.

Authentication establishes identity. The backend determines authorization.

## 3\. Domain and Login Architecture

Use the following example hostnames. Keep the actual domain configurable through environment variables.

| Hostname | Purpose |
| --- | --- |
| `example.com` | Public landing page |
| `login.example.com` | Shared Resident/Admin login entry point |
| `app.example.com` | Resident application |
| `admin.example.com` | Tenant Admin application |
| `ops-login.example.com` | Separate Operator login entry point |
| `ops.example.com` | Private Operator console |
| `api.example.com` | Backend API |

### Resident/Admin Login

1. An unauthenticated Resident or Tenant Admin opens their application.
2. The application redirects the user to the shared login flow.
3. Auth0 authenticates the user.
4. The application establishes its own secure server-side session.
5. The backend resolves the user's tenant memberships and authorized roles.
6. If the user has exactly one available experience, redirect to its default page.
7. If the user has multiple available experiences, display an experience-selection page.
8. Validate the selected experience against backend-provided authorization data.
9. Redirect to the appropriate application using an allowlisted destination.
10. Enforce authorization independently in every protected API request.

Resident/Admin experience selection is a navigation decision, not a permission grant.

### Operator Login

1. An Operator navigates to `ops-login.example.com` or opens a protected page at `ops.example.com`.
2. The Operator is redirected to the dedicated Operator authentication entry point.
3. The Operator authenticates using the configured Auth0 application and stricter authentication policy.
4. The Operator application validates the authentication response and establishes its own secure session.
5. The backend verifies the Operator's platform-level permissions.
6. The user is redirected to `ops.example.com` only if authorized.
7. Unauthorized users receive an access-denied response.
8. Operator sessions and sensitive actions follow stricter security and auditing policies.

The Operator login flow must not redirect into the Resident/Admin experience selector.

A separate hostname does not make the Operator application private by itself. Protect the console using appropriate network or identity-aware access controls, application authentication, API authorization, MFA, and audit logging.

### Auth0 Configuration

Use separate Auth0 application registrations for the Resident web app, Admin web app, and Operator web app. The shared login entry point orchestrates the Resident/Admin experience; it does not replace Auth0 as the identity provider.

Use the appropriate Auth0 SDK or maintained OIDC integration for each framework.

Register exact callback and logout URLs. Validate OAuth/OIDC state, nonce, PKCE where applicable, and authorization responses.

Use separate client credentials and session configuration where appropriate. Never expose client secrets to browser code.

For the future mobile application, use an Auth0 Native application with Authorization Code Flow and PKCE through the system browser.

Choose whether to use separate Auth0 Organizations, tenants, or connections based on the actual identity and isolation requirements. Do not assume that separate web hostnames automatically create separate security boundaries.


## 5\. Full Repository Structure

```
my-saas/
├── apps/
│   ├── login-web/                 # Shared Resident/Admin login entry
│   ├── resident-web/              # Resident Next.js app
│   ├── admin-web/                 # Tenant Admin Next.js app
│   ├── operator-web/              # Internal Operator Next.js app
│   ├── api/                       # Backend modular monolith
│   ├── worker/                    # Background jobs
│   └── resident-mobile/           # Future Expo app
│
├── packages/
│   ├── ui/                        # Shared UI primitives
│   ├── design-tokens/             # Design tokens
│   ├── contracts/                 # Shared API schemas
│   ├── api-client/                # Typed API client
│   ├── validation/                # Shared validation schemas
│   ├── auth-types/                # Shared non-secret auth types
│   ├── config-eslint/
│   └── config-typescript/
│
├── database/
│   ├── migrations/
│   └── seeds/
│
├── infrastructure/
│   ├── proxy/
│   │   └── nginx.conf
│   ├── auth0/
│   │   └── README.md
│   └── scripts/
│
├── tests/
│   ├── e2e/
│   │   ├── resident/
│   │   ├── admin/
│   │   ├── operator/
│   │   └── invitations/
│   ├── integration/
│   └── security/
│
├── compose.yaml
├── compose.dev.yaml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .env.example
├── .gitignore
└── README.md
```

Implement the Operator login route inside `operator-web`, for example at `/login`, while exposing it through `ops-login.example.com` using the reverse proxy if a separate login application is not required.

This avoids maintaining an unnecessary additional Next.js app while preserving the separate Operator authentication entry point.

## 6\. Resident Web Structure

```
apps/resident-web/
├── public/
│   └── icons/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   └── welcome/page.tsx
│   │   ├── (resident)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── requests/page.tsx
│   │   │   ├── profile/page.tsx
│   │   │   └── notifications/page.tsx
│   │   ├── auth/
│   │   │   └── callback/route.ts
│   │   ├── manifest.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── features/
│   │   ├── dashboard/
│   │   ├── requests/
│   │   ├── profile/
│   │   └── notifications/
│   ├── components/
│   │   ├── navigation/
│   │   └── layout/
│   └── lib/
│       ├── auth.ts
│       ├── session.ts
│       └── api-client.ts
├── next.config.ts
├── Dockerfile
└── package.json
```

## 7\. Tenant Admin Web Structure

```
apps/admin-web/
├── src/
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── residents/page.tsx
│   │   │   ├── invitations/page.tsx
│   │   │   ├── reports/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   └── billing/page.tsx
│   │   ├── auth/
│   │   │   └── callback/route.ts
│   │   ├── manifest.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── features/
│   │   ├── residents/
│   │   ├── invitations/
│   │   ├── reports/
│   │   ├── settings/
│   │   └── billing/
│   ├── components/
│   └── lib/
│       ├── auth.ts
│       ├── session.ts
│       └── api-client.ts
├── next.config.ts
├── Dockerfile
└── package.json
```

## 8\. Operator Web Structure

```
apps/operator-web/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── access-denied/page.tsx
│   │   ├── (console)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── tenants/page.tsx
│   │   │   ├── invitations/page.tsx
│   │   │   ├── jobs/page.tsx
│   │   │   ├── audit-logs/page.tsx
│   │   │   └── feature-flags/page.tsx
│   │   ├── auth/
│   │   │   └── callback/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── features/
│   │   ├── tenants/
│   │   ├── invitations/
│   │   ├── jobs/
│   │   ├── audit-logs/
│   │   └── access-control/
│   └── lib/
│       ├── auth.ts
│       ├── session.ts
│       └── api-client.ts
├── next.config.ts
├── Dockerfile
└── package.json
```

The Operator application must not use the public Resident/Admin experience selector.

## 9\. Shared Login Web Structure

```
apps/login-web/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── choose-experience/page.tsx
│   │   │   └── access-denied/page.tsx
│   │   ├── auth/
│   │   │   └── callback/route.ts
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── features/
│   │   ├── login/
│   │   └── experience-selection/
│   └── lib/
│       ├── auth0.ts
│       ├── destinations.ts
│       └── session.ts
├── next.config.ts
├── Dockerfile
└── package.json
```

The shared login app handles Resident/Admin entry and experience selection. Auth0 remains the identity provider. Avoid implementing a second authentication protocol inside the login app.

## 10\. API Structure

Use a modular monolith with clear business-domain boundaries.

```
apps/api/
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── config/
│   ├── middleware/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── tenants/
│   │   ├── memberships/
│   │   ├── invitations/
│   │   ├── residents/
│   │   ├── requests/
│   │   ├── billing/
│   │   ├── notifications/
│   │   └── audit/
│   ├── infrastructure/
│   │   ├── database/
│   │   ├── queue/
│   │   ├── cache/
│   │   └── storage/
│   └── common/
├── tests/
├── Dockerfile
└── package.json
```

Each module should encapsulate its own routes/controllers, application services, validation, authorization policies, and persistence logic as appropriate.

Do not allow modules to bypass another module's business rules by directly manipulating its internal data.

### API Responsibilities

- Validate Auth0 access tokens using the configured issuer and audience.
- Resolve the authenticated user to an internal user record.
- Enforce platform-level Operator permissions.
- Enforce tenant membership and role-based authorization.
- Enforce tenant boundaries on all tenant-owned resources.
- Create, validate, revoke, and accept invitations.
- Provide typed, documented API contracts.
- Record sensitive actions and security-relevant events.
- Keep business logic independent of the web application that invokes it.

### audit\_logs

- `id`
- `actor_user_id`
- `tenant_id`, nullable for platform-wide events
- `action`
- `resource_type`
- `resource_id`
- `metadata`
- `created_at`

Use foreign keys, indexes, unique constraints, and transactions where appropriate.

Enforce membership uniqueness and invitation lifecycle rules at the database or transactional application layer.

Never rely on frontend filtering as a tenant-isolation control.

## 13\. Shared Packages

```
packages/
├── ui/
├── design-tokens/
├── contracts/
├── api-client/
├── validation/
├── auth-types/
├── config-eslint/
└── config-typescript/
```

Sharing rules:

- Share generic UI primitives, not complete application-specific page layouts.
- Share API schemas and generated or typed API clients.
- Keep application-specific navigation independent.
- Keep Auth0 secrets and session implementation server-side.
- Do not import database or backend-only modules into browser bundles.
- Do not treat shared TypeScript types as runtime authorization.
- Keep Operator-only functionality out of public application bundles.


## 15\. Docker Compose and Infrastructure

Run the following services initially:

```
Docker Compose
├── login-web
├── resident-web
├── admin-web
├── operator-web
├── api
├── worker
├── postgres
├── redis (only if needed)
└── reverse-proxy

External managed service
└── Auth0
```

The reverse proxy routes requests to the appropriate web application and API.

Keep internal services off public host ports wherever possible. Configure HTTPS, health checks, service dependencies, persistent database storage, database backups, and environment-specific configuration.

Operator routes should have additional access controls. Network restrictions are defense in depth and must not replace application authentication and API authorization.

Use separate development overrides in `compose.dev.yaml`. Never commit production secrets.

## 17\. Workspace Configuration

Use pnpm workspaces:

```
packages:
  - "apps/*"
  - "packages/*"
```

Use Turborepo for build orchestration, caching, linting, type checking, and tests.

Commit `pnpm-lock.yaml`. Pin compatible dependency versions and use reproducible builds.

## 18\. Progressive Web App Requirements

Implement PWA support where useful, especially for Resident workflows.

- Responsive layouts across mobile, tablet, and desktop.
- Appropriate web app manifests and icons.
- Accessible navigation and forms.
- Deliberate service-worker caching policies.
- Do not cache authenticated API responses or sensitive tenant data indiscriminately.
- Handle offline behavior explicitly.
- Never treat offline UI state as proof of authorization.

Admin may also support PWA installation. Operator PWA support is optional and should not weaken its security requirements.

### Tenant Isolation

- A Tenant Admin cannot read or modify another tenant's data.
- A Resident cannot access another resident's private resources.
- A client cannot escalate permissions by changing a tenant ID or role.
- Operator permissions are explicitly checked.
- Sensitive actions generate audit records.

### Deployment

- Production builds for all applications.
- Container health checks.
- Database migration verification.
- Configuration and secret validation.
- E2E tests through the reverse proxy.

## 20\. Development Principles

- Prefer a modular monolith over microservices for the initial release.
- Keep frontend applications independently deployable.
- Keep business logic inside backend modules.
- Avoid duplicating business rules across web applications.
- Keep authentication and authorization distinct.
- Treat Auth0 identity claims as identity information, not the complete source of tenant authorization.
- Enforce authorization on every protected backend operation.
- Keep tenant boundaries explicit in database queries and domain services.
- Use transactions for membership and invitation state changes.
- Use audit logs for sensitive platform and tenant administration actions.
- Avoid premature abstractions and unnecessary shared packages.
- Keep API contracts stable and mobile-friendly.
- Extract a backend module into a microservice only when there is a concrete scaling, ownership, reliability, or deployment need.

## 21\. Recommended Implementation Order

1. Set up the pnpm + Turborepo monorepo.
2. Configure Auth0 applications, callback URLs, and the API audience.
3. Implement the PostgreSQL schema and database migrations.
4. Implement users, tenants, memberships, and authorization.
7. Implement the shared Resident/Admin login and experience-selection flow.
8. Implement the separate Operator login entry point and protected console.
10. Configure Docker Compose, HTTPS, reverse-proxy routing, and health checks.
11. Implement responsive UI and PWA support.
12. Add integration, security, and end-to-end tests.
13. Add the Expo mobile app when the web product is stable.

## Final Architecture Decision

- One pnpm + Turborepo monorepo.
- Four Next.js applications: Login, Resident, Admin, and Operator.
- Shared Resident/Admin login flow.
- Separate Operator login entry point and security policy.
- Auth0 for authentication and identity.
- Tenant-scoped roles and memberships stored in PostgreSQL.
- Operator-created tenant and Admin invitation workflow.
- Admin-created Resident invitation workflow.
- One modular monolith API.
- One background Worker.
- Docker Compose for initial orchestration.
- Shared API contracts for future mobile applications.
- Clear module boundaries for potential future microservices.

All implementations must preserve tenant isolation, enforce authorization on the backend, protect Operator functionality, and avoid exposing secrets to browser or mobile clients.