ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

# ========== 1) deps ==========
FROM ${BUILD_BASE} AS deps
ENV NODE_ENV=development
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/project/package.json ./services/project/
RUN pnpm install --frozen-lockfile --prod=false

# ========== 2) builder ==========
FROM deps AS builder
COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/project ./services/project

RUN cd /app/services/shared && /app/node_modules/.bin/tsc
RUN /app/node_modules/.bin/prisma generate --schema services/project/prisma/schema.prisma
RUN cd /app/services/project && /app/node_modules/.bin/tsc

# ========== 3) runner ==========
FROM ${RUNTIME_BASE} AS runner
COPY --from=builder --chown=app:app /app/services/project/dist           ./dist
COPY --from=builder --chown=app:app /app/services/project/prisma         ./prisma
COPY --from=builder --chown=app:app /app/services/project/package.json   ./package.json
COPY --from=builder --chown=app:app /app/node_modules                    ./node_modules
COPY --from=builder --chown=app:app /app/services/shared/dist            ./node_modules/@erp-ot/shared/dist
COPY --from=builder --chown=app:app /app/services/shared/package.json    ./node_modules/@erp-ot/shared/package.json
COPY --chown=app:app services/project/entrypoint.sh                      ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# 첨부 저장 경로(STORAGE_PATH=/app/storage) 사전 생성 + app 소유.
# 신규 named volume 마운트 시 이 디렉터리 소유권(app:app)이 볼륨으로 복사됨 → EACCES 방지.
RUN mkdir -p /app/storage && chown -R app:app /app/storage

USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -q -O- http://localhost:3003/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
