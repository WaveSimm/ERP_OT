#!/bin/sh
set -e

echo "Waiting for database..."
until npx prisma db push --skip-generate 2>&1; do
  echo "DB not ready, retrying in 3s..."
  sleep 3
done

echo "Running seed..."
npx tsx prisma/seed.ts || echo "Seed skipped (already seeded or error)"

echo "DB ready. Starting expense-service..."
exec node dist/index.js
