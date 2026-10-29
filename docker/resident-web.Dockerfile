# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:$PATH"
RUN corepack enable && mkdir -p /workspace && chown node:node /workspace
WORKDIR /workspace
USER node

# Keep dependency installation cached when only source files change.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/admin-web/package.json ./apps/admin-web/
COPY --chown=node:node apps/api/package.json ./apps/api/
COPY --chown=node:node apps/operator-web/package.json ./apps/operator-web/
COPY --chown=node:node apps/resident-web/package.json ./apps/resident-web/
COPY --chown=node:node apps/resident-auth/package.json ./apps/resident-auth/
COPY --chown=node:node apps/worker/package.json ./apps/worker/
COPY --chown=node:node infrastructure/adapters/package.json ./infrastructure/adapters/
COPY --chown=node:node infrastructure/ports/package.json ./infrastructure/ports/
COPY --chown=node:node packages/api-client/package.json ./packages/api-client/
COPY --chown=node:node packages/app-platform/package.json ./packages/app-platform/
COPY --chown=node:node packages/application/package.json ./packages/application/
COPY --chown=node:node packages/auth-types/package.json ./packages/auth-types/
COPY --chown=node:node packages/config/package.json ./packages/config/
COPY --chown=node:node packages/contracts/package.json ./packages/contracts/
COPY --chown=node:node packages/design-tokens/package.json ./packages/design-tokens/
COPY --chown=node:node packages/domain/package.json ./packages/domain/
COPY --chown=node:node packages/shared/package.json ./packages/shared/
COPY --chown=node:node packages/ui/package.json ./packages/ui/
RUN --mount=type=cache,id=myapartment-pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store

COPY --chown=node:node . .

RUN pnpm --filter @block9/config run build && \
    pnpm --filter @block9/domain run build && \
    pnpm --filter @block9/shared run build && \
    pnpm --filter @block9/contracts run build && \
    pnpm --filter @block9/application run build && \
    pnpm --filter @block9/ports run build && \
    pnpm --filter @block9/adapters run build

FROM base AS development
WORKDIR /workspace/apps/resident-web

EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "dev", "-H", "0.0.0.0", "-p", "3000"]

FROM base AS builder
ARG WEB_HSTS=false
ENV WEB_HSTS=$WEB_HSTS
ARG PHOTO_STORAGE_ORIGIN
ENV PHOTO_STORAGE_ORIGIN=$PHOTO_STORAGE_ORIGIN
RUN pnpm --filter @block9/resident-web run build

FROM node:22-alpine AS production
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /workspace/apps/resident-web/.next/standalone ./
COPY --from=builder --chown=app:app /workspace/apps/resident-web/.next/static ./apps/resident-web/.next/static
COPY --from=builder --chown=app:app /workspace/apps/resident-web/public ./apps/resident-web/public
USER app
EXPOSE 3000
CMD ["node", "apps/resident-web/server.js"]
