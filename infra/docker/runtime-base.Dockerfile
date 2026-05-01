FROM node:20-alpine

# 최소 runtime deps (HEALTHCHECK용 wget + prisma용 openssl)
RUN apk add --no-cache openssl libc6-compat wget

# pnpm — production install + entrypoint에서 prisma db push 사용
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# non-root user (8개 서비스 공통 — OQ-7 결정)
RUN addgroup -g 1001 -S app && adduser -S app -G app -u 1001

ENV NODE_ENV=production
ENV TZ=Asia/Seoul

WORKDIR /app
RUN chown -R app:app /app
