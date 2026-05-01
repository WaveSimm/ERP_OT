ARG BUILD_BASE=erp-ot-build-base:latest
ARG RUNTIME_BASE=erp-ot-runtime-base:latest

# ========== 1) deps ==========
FROM ${BUILD_BASE} AS deps
ENV NODE_ENV=development
COPY pnpm-workspace.yaml .npmrc pnpm-lock.yaml package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/user/package.json ./services/user/
RUN pnpm install --frozen-lockfile --prod=false

# ========== 2) builder ==========
FROM deps AS builder
COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/user ./services/user

RUN cd /app/services/shared && /app/node_modules/.bin/tsc
RUN cd /app/services/user && /app/node_modules/.bin/tsc

# ========== 3) runner ==========
FROM ${RUNTIME_BASE} AS runner
COPY --from=builder --chown=app:app /app/services/user/dist           ./dist
COPY --from=builder --chown=app:app /app/services/user/package.json   ./package.json
COPY --from=builder --chown=app:app /app/node_modules                 ./node_modules
COPY --from=builder --chown=app:app /app/services/shared/dist         ./node_modules/@erp-ot/shared/dist
COPY --from=builder --chown=app:app /app/services/shared/package.json ./node_modules/@erp-ot/shared/package.json

USER app
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD wget -q -O- http://localhost:3002/health || exit 1
CMD ["node", "dist/index.js"]
