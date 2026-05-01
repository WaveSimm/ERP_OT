ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

# ========== 1) deps ==========
FROM ${BUILD_BASE} AS deps
ENV NODE_ENV=development
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --prod=false

# ========== 2) builder ==========
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/config ./packages/config
COPY apps/web ./apps/web
RUN cd /app/apps/web && /app/node_modules/.bin/next build

# ========== 3) runner ==========
FROM ${RUNTIME_BASE} AS runner

# Next.js standalone — server.js + 최소 node_modules는 standalone에 포함
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public           ./apps/web/public

USER app
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -q -O- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
