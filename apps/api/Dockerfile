# ADR 0006: images are built by GitHub Actions, pushed to GHCR, and pulled by
# Docker Compose on the VPS.
FROM node:20.20.2-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b apps/api
RUN pnpm deploy --filter @apps/api --prod /app

FROM node:20.20.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./
# Migrations ship with the image so `db:migrate` can run against the same
# version that is about to serve traffic.
COPY --from=build /repo/packages/db/migrations ./node_modules/@platform/db/migrations

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
