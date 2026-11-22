# Nakes admin web image (Next.js standalone). Build from the repository root; the API URL is baked in at build time:
#   docker build -f apps/admin-web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 -t nakes-web .
#   docker run -p 3000:3000 nakes-web
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_OUTPUT=standalone
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/admin-web/package.json apps/admin-web/
COPY packages/api-contracts/package.json packages/api-contracts/
RUN pnpm install --frozen-lockfile --filter @nakes/admin-web...
COPY apps/admin-web apps/admin-web
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
RUN pnpm --filter @nakes/admin-web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/admin-web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin-web/.next/static ./apps/admin-web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/admin-web/server.js"]
