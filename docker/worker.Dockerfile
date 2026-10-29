# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:$PATH"
RUN corepack enable && mkdir -p /workspace && chown node:node /workspace
WORKDIR /workspace
USER node
COPY --chown=node:node . .
RUN --mount=type=cache,id=myapartment-pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm --filter @block9/config run build && \
    pnpm --filter @block9/domain run build && \
    pnpm --filter @block9/shared run build && \
    pnpm --filter @block9/application run build && \
    pnpm --filter @block9/ports run build && \
    pnpm --filter @block9/adapters run build && \
    pnpm --filter @block9/worker run build

FROM base AS development
WORKDIR /workspace/apps/worker
EXPOSE 4010
CMD ["node", "dist/apps/worker/src/index.js"]

FROM base AS production-build
RUN pnpm --filter @block9/worker deploy --prod /workspace/runtime

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-build --chown=node:node /workspace/runtime ./
USER node
EXPOSE 4010
CMD ["node", "dist/apps/worker/src/index.js"]
