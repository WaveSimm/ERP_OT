FROM node:20-alpine AS base
RUN apk add --no-cache openssl gcompat
RUN npm install -g pnpm@9

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY services/approval/package.json ./services/approval/
COPY services/shared/package.json ./services/shared/

RUN pnpm install

COPY packages/config ./packages/config
COPY services/approval/ ./services/approval/
COPY services/shared/ ./services/shared/

RUN cd /app/services/shared && node /app/node_modules/typescript/bin/tsc
RUN cd /app/services/approval  && node /app/node_modules/prisma/build/index.js generate
RUN cd /app/services/approval  && node /app/node_modules/typescript/bin/tsc

FROM base AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/services/approval/dist ./dist
COPY --from=builder /app/services/approval/prisma ./prisma
COPY --from=builder /app/services/shared/dist ./node_modules/@erp-ot/shared/dist
COPY --from=builder /app/services/shared/package.json ./node_modules/@erp-ot/shared/package.json
COPY services/approval/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
RUN mkdir -p /app/uploads

ENV NODE_ENV=production
EXPOSE 3006
ENTRYPOINT ["./entrypoint.sh"]
