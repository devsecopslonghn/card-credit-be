# syntax=docker/dockerfile:1

FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY shared/package.json shared/package-lock.json /shared/
RUN --mount=type=cache,id=card-credit-shared-npm,target=/root/.npm npm --prefix /shared ci --omit=dev
COPY shared /shared
COPY backend/package.json backend/package-lock.json ./
RUN --mount=type=cache,id=card-credit-backend-build-npm,target=/root/.npm npm ci

FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS builder
WORKDIR /app
COPY --from=deps /shared /shared
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ .
RUN npm run build
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=3001
ENV CARD_CATALOG_PATH=/app/catalog/card-presets.json
RUN apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx && \
    addgroup -S backend && \
    adduser -S backend -G backend
ENV NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register"
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /shared /shared
COPY --from=builder /app/dist ./dist
COPY backend/catalog/card-presets.json ./catalog/card-presets.json
USER backend
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
