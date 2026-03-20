FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN npm install -g pnpm@9

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY services/auth/package.json ./services/auth/
COPY services/shared/package.json ./services/shared/

RUN pnpm install

COPY packages/config ./packages/config
COPY services/auth/ ./services/auth/
COPY services/shared/ ./services/shared/

RUN cd /app/services/shared && node /app/node_modules/typescript/bin/tsc
RUN cd /app/services/auth  && node /app/node_modules/prisma/build/index.js generate
RUN cd /app/services/auth  && node /app/node_modules/typescript/bin/tsc

FROM base AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/services/auth/dist ./dist
COPY --from=builder /app/services/auth/prisma ./prisma
COPY --from=builder /app/services/shared/dist ./node_modules/@erp-ot/shared/dist
COPY --from=builder /app/services/shared/package.json ./node_modules/@erp-ot/shared/package.json
COPY services/auth/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["./entrypoint.sh"]
