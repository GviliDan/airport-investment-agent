# syntax=docker/dockerfile:1
# Build context is the repository root (needs the root lockfile and the shared workspace).
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS manifests
WORKDIR /repo
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM manifests AS build-deps
RUN npm ci --workspace apps/api --workspace packages/shared --include-workspace-root

FROM build-deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM manifests AS prod-deps
RUN npm ci --omit=dev --workspace apps/api \
 && rm -rf node_modules/@airport

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health" >/dev/null || exit 1
# Run node directly (not via npm) so SIGTERM reaches the process.
CMD ["node", "dist/main.js"]
