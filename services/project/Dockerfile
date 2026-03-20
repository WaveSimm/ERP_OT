FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable pnpm

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml .npmrc ./
COPY package.json ./
COPY packages/config/package.json ./packages/config/
COPY services/shared/package.json ./services/shared/
COPY services/project/package.json ./services/project/
RUN pnpm install

COPY packages/config ./packages/config
COPY services/shared ./services/shared
COPY services/project ./services/project

RUN cd /app/services/shared  && node /app/node_modules/typescript/bin/tsc
RUN cd /app/services/project && node /app/node_modules/prisma/build/index.js generate
RUN cd /app/services/project && node /app/node_modules/typescript/bin/tsc

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/services/project/dist ./dist
COPY --from=builder /app/services/project/prisma ./prisma
COPY --from=builder /app/services/shared/dist ./node_modules/@erp-ot/shared/dist
COPY --from=builder /app/services/shared/package.json ./node_modules/@erp-ot/shared/package.json
COPY services/project/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3003
ENTRYPOINT ["./entrypoint.sh"]
