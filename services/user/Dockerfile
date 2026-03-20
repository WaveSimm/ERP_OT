FROM node:20-alpine AS base
RUN apk add --no-cache openssl
RUN npm install -g pnpm@9

FROM base AS builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY services/user/package.json ./services/user/
COPY services/shared/package.json ./services/shared/

RUN pnpm install

COPY packages/config ./packages/config
COPY services/user/ ./services/user/
COPY services/shared/ ./services/shared/

RUN cd /app/services/shared && node /app/node_modules/typescript/bin/tsc
RUN cd /app/services/user  && node /app/node_modules/typescript/bin/tsc

FROM base AS runner
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /app/services/user/dist ./dist

ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "dist/index.js"]
