FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:$PATH"
RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY infrastructure ./infrastructure
COPY apps ./apps
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @nivasa/config run build && \
    pnpm --filter @nivasa/domain run build && \
    pnpm --filter @nivasa/shared run build && \
    pnpm --filter @nivasa/application run build && \
    pnpm --filter @nivasa/ports run build && \
    pnpm --filter @nivasa/adapters run build && \
    pnpm --filter @nivasa/worker run build

RUN chown -R node:node /workspace
USER node

EXPOSE 4010
CMD ["node", "apps/worker/dist/apps/worker/src/index.js"]
