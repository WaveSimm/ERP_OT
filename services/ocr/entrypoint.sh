#!/bin/sh
set -e

echo "Waiting for database..."
until npx prisma db push --skip-generate --accept-data-loss 2>&1; do
  echo "DB not ready, retrying in 3s..."
  sleep 3
done

echo "Running seed if needed..."
npx tsx prisma/seed.ts 2>/dev/null || true

echo "DB schema ready. Starting ocr-service..."
exec node dist/index.js
