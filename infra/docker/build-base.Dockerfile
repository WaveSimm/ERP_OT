FROM node:20-alpine

# 빌드용 toolchain (서비스 빌드 단계에서만 사용 — runner stage에는 안 들어감)
RUN apk add --no-cache \
      openssl libc6-compat \
      python3 make g++ \
      git curl

# pnpm 9 (corepack 표준)
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# pnpm 캐시 디렉토리
ENV PNPM_HOME=/root/.pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /app
