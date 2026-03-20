#!/bin/sh
set -e

echo "Waiting for database..."
until npx prisma db push --skip-generate 2>&1; do
  echo "DB not ready, retrying in 3s..."
  sleep 3
done

echo "DB schema ready. Starting service..."
exec node dist/index.js
