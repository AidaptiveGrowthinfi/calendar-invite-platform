FROM node:20.20.2-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b apps/worker
# --legacy: pnpm 10 refuses `deploy` unless workspace packages are injected.
RUN pnpm deploy --legacy --filter @apps/worker --prod /app

FROM node:20.20.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["node", "dist/main.js"]
