ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

# ========== 1) deps ==========
FROM ${BUILD_BASE} AS deps
ENV NODE_ENV=development
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/approval/package.json ./services/approval/
RUN pnpm install --frozen-lockfile --prod=false

# ========== 2) builder ==========
FROM deps AS builder
COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/approval ./services/approval

RUN cd /app/services/shared && /app/node_modules/.bin/tsc
RUN /app/node_modules/.bin/prisma generate --schema services/approval/prisma/schema.prisma
RUN cd /app/services/approval && /app/node_modules/.bin/tsc

# ========== 3) runner ==========
FROM ${RUNTIME_BASE} AS runner
# approval-service 전용 native 호환 (OQ-2 결정)
USER root
RUN apk add --no-cache gcompat
USER app

COPY --from=builder --chown=app:app /app/services/approval/dist           ./dist
COPY --from=builder --chown=app:app /app/services/approval/prisma         ./prisma
COPY --from=builder --chown=app:app /app/services/approval/package.json   ./package.json
COPY --from=builder --chown=app:app /app/node_modules                     ./node_modules
COPY --from=builder --chown=app:app /app/services/shared/dist             ./node_modules/@erp-ot/shared/dist
COPY --from=builder --chown=app:app /app/services/shared/package.json     ./node_modules/@erp-ot/shared/package.json
COPY --chown=app:app services/approval/entrypoint.sh                      ./entrypoint.sh
USER root
RUN chmod +x ./entrypoint.sh && mkdir -p /app/uploads && chown -R app:app /app/uploads
USER app

EXPOSE 3006
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -q -O- http://localhost:3006/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
