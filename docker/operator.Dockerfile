FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:$PATH"
ARG NEXT_PUBLIC_API_URL=http://localhost:4101
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
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
    pnpm --filter @nivasa/contracts run build && \
    pnpm --filter @nivasa/application run build && \
    pnpm --filter @nivasa/ports run build && \
    pnpm --filter @nivasa/adapters run build && \
    pnpm --filter @nivasa/operator-web run build

RUN chown -R node:node /workspace
USER node
WORKDIR /workspace/apps/operator-web

EXPOSE 3001
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3001"]
