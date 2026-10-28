# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:$PATH"
RUN corepack enable && mkdir -p /workspace && chown node:node /workspace
WORKDIR /workspace
USER node
COPY --chown=node:node . .
RUN --mount=type=cache,id=myapartment-pnpm-store,target=/pnpm/store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN pnpm --filter @block9/resident-auth build
RUN pnpm --filter @block9/resident-auth deploy --prod /workspace/runtime

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /workspace/runtime ./
USER node
ENV NODE_ENV=production
EXPOSE 4120
CMD ["node", "dist/index.js"]
