#!/usr/bin/env bash
# 부하테스트 — docker stats + pg_stat_activity 시계열 캡처
# Usage: bash capture-metrics.sh <duration_sec> <label>
set -euo pipefail

DURATION="${1:-720}"
LABEL="${2:-default}"
OUT_DIR="docs/04-operation/load-test-results/${LABEL}"
mkdir -p "$OUT_DIR"

PG_CONTAINER="${PG_CONTAINER:-erp-ot-postgres}"
PG_USER="${PG_USER:-erp_user}"
PG_DB="${PG_DB:-erp_ot}"

STATS_CSV="$OUT_DIR/stats.csv"
PG_CSV="$OUT_DIR/pg_active.csv"

echo "ts,name,cpu_pct,mem_usage,mem_pct" > "$STATS_CSV"
echo "ts,active_conns,idle_conns,total_conns" > "$PG_CSV"

# docker stats 1초 간격
(while true; do
  TS=$(date +%s)
  docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}" \
    | sed "s/^/$TS,/" >> "$STATS_CSV" 2>/dev/null || true
  sleep 1
done) &
STATS_PID=$!

# pg_stat 5초 간격
(while true; do
  TS=$(date +%s)
  COUNTS=$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -F',' -c "
    SELECT
      COUNT(*) FILTER (WHERE state='active'),
      COUNT(*) FILTER (WHERE state='idle'),
      COUNT(*)
    FROM pg_stat_activity
    WHERE datname='$PG_DB';
  " 2>/dev/null || echo ',,')
  echo "$TS,$COUNTS" >> "$PG_CSV"
  sleep 5
done) &
PG_PID=$!

trap "kill $STATS_PID $PG_PID 2>/dev/null || true" EXIT INT TERM

echo "[capture] PIDs: stats=$STATS_PID pg=$PG_PID, duration=${DURATION}s, output=$OUT_DIR"
sleep "$DURATION"

kill $STATS_PID $PG_PID 2>/dev/null || true
echo "[capture] done — $STATS_CSV, $PG_CSV"
