# Nakes API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t nakes-api .
# Release step (once per deploy, before starting new instances):
#   docker run --rm --env-file apps/api/.env nakes-api pnpm --filter @nakes/api prisma:deploy
# Run:
#   docker run -p 4000:4000 --env-file apps/api/.env nakes-api
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/admin-web/package.json apps/admin-web/
COPY packages/api-contracts/package.json packages/api-contracts/
RUN pnpm install --frozen-lockfile --filter @nakes/api...
COPY apps/api apps/api
RUN pnpm --filter @nakes/api prisma:generate && pnpm --filter @nakes/api build

# The runtime keeps the installed dependencies, including the Prisma CLI for the migration release step and the
# generated client, which lives inside node_modules.
FROM base AS runtime
ENV NODE_ENV=production PORT=4000
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
