ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

# ========== 1) deps ==========
FROM ${BUILD_BASE} AS deps
ENV NODE_ENV=development
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/expense/package.json ./services/expense/
RUN pnpm install --frozen-lockfile --prod=false

# ========== 2) builder ==========
FROM deps AS builder
COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/expense ./services/expense

RUN cd /app/services/shared && /app/node_modules/.bin/tsc
RUN /app/node_modules/.bin/prisma generate --schema services/expense/prisma/schema.prisma
RUN cd /app/services/expense && /app/node_modules/.bin/tsc

# ========== 3) runner ==========
FROM ${RUNTIME_BASE} AS runner
COPY --from=builder --chown=app:app /app/services/expense/dist           ./dist
COPY --from=builder --chown=app:app /app/services/expense/prisma         ./prisma
COPY --from=builder --chown=app:app /app/services/expense/package.json   ./package.json
COPY --from=builder --chown=app:app /app/node_modules                    ./node_modules
COPY --from=builder --chown=app:app /app/services/shared/dist            ./node_modules/@erp-ot/shared/dist
COPY --from=builder --chown=app:app /app/services/shared/package.json    ./node_modules/@erp-ot/shared/package.json
COPY --chown=app:app services/expense/entrypoint.sh                      ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# 영수증 첨부 저장 루트 (named volume이 처음 마운트될 때 ownership 복사)
RUN mkdir -p /app/uploads && chown -R app:app /app/uploads

USER app
EXPOSE 3008
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -q -O- http://localhost:3008/health || exit 1
ENTRYPOINT ["./entrypoint.sh"]
