#!/usr/bin/env bash
# Backfill embeddings for board_posts (public schema) and work_logs (project schema).
#
# For each row missing embedding:
#   1. SELECT text via psql (bytea-encoded as base64 to be safe)
#   2. Call Ollama /api/embed
#   3. UPDATE row with returned vector
#
# Usage:
#   bash scripts/backfill-embeddings.sh                  # both
#   bash scripts/backfill-embeddings.sh posts            # posts only
#   bash scripts/backfill-embeddings.sh worklogs         # worklogs only

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-erp-ot-postgres}"
PG_USER="${PG_USER:-erp_user}"
PG_DB="${PG_DB:-erp_ot}"
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-bge-m3}"
MAX_INPUT_CHARS=4000

target="${1:-all}"

psql_oneline() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -c "$1"
}

# Fetch text content for a single row, base64-encoded for safe transport
fetch_post_text_b64() {
  local id="$1"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At \
    -v pid="$id" \
    -c "SELECT encode(convert_to(COALESCE(title,'') || E'\n\n' || COALESCE(content,''), 'UTF8'), 'base64') FROM public.board_posts WHERE id = :'pid';"
}

fetch_worklog_text_b64() {
  local id="$1"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At \
    -v wid="$id" \
    -c "SELECT encode(convert_to(COALESCE(content,''), 'UTF8'), 'base64') FROM project.work_logs WHERE id = :'wid';"
}

embed_text() {
  local text="$1"
  text="${text:0:$MAX_INPUT_CHARS}"
  local body
  body=$(jq -n --arg model "$EMBEDDING_MODEL" --arg input "$text" '{model:$model,input:$input}')
  curl -s --max-time 60 -X POST "$OLLAMA_URL/api/embed" \
    -H "content-type: application/json" \
    -d "$body" | jq -r 'if .embeddings and (.embeddings|length>0) then "[" + (.embeddings[0] | map(tostring) | join(",")) + "]" else "" end'
}

update_post_embedding() {
  local id="$1" vec="$2"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
    -v vec="$vec" -v pid="$id" \
    -c "UPDATE public.board_posts SET embedding = :'vec'::vector, embedded_at = NOW() WHERE id = :'pid';" >/dev/null
}

update_worklog_embedding() {
  local id="$1" vec="$2"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
    -v vec="$vec" -v wid="$id" \
    -c "UPDATE project.work_logs SET embedding = :'vec'::vector, embedded_at = NOW() WHERE id = :'wid';" >/dev/null
}

backfill_posts() {
  local ids
  ids=$(psql_oneline "SELECT id FROM public.board_posts WHERE embedding IS NULL AND deleted_at IS NULL ORDER BY published_at DESC NULLS LAST LIMIT 1000;")
  local total=0 ok=0 fail=0
  total=$(echo -n "$ids" | grep -c . || true)
  echo "[posts] $total rows to embed"
  for id in $ids; do
    [ -z "$id" ] && continue
    local b64 text vec
    b64=$(fetch_post_text_b64 "$id")
    text=$(echo "$b64" | base64 -d)
    if [ -z "$text" ]; then
      echo "[posts] empty text for $id, skip"
      fail=$((fail + 1))
      continue
    fi
    vec=$(embed_text "$text" || true)
    if [ -z "$vec" ]; then
      echo "[posts] embed failed for $id"
      fail=$((fail + 1))
      continue
    fi
    update_post_embedding "$id" "$vec"
    ok=$((ok + 1))
    printf "."
  done
  echo
  echo "[posts] done — ok=$ok, fail=$fail (total=$total)"
}

backfill_worklogs() {
  local ids
  ids=$(psql_oneline "SELECT id FROM project.work_logs WHERE embedding IS NULL AND deleted_at IS NULL ORDER BY worked_at DESC LIMIT 5000;")
  local total=0 ok=0 fail=0
  total=$(echo -n "$ids" | grep -c . || true)
  echo "[worklogs] $total rows to embed"
  for id in $ids; do
    [ -z "$id" ] && continue
    local b64 text vec
    b64=$(fetch_worklog_text_b64 "$id")
    text=$(echo "$b64" | base64 -d)
    if [ -z "$text" ]; then
      echo "[worklogs] empty text for $id, skip"
      fail=$((fail + 1))
      continue
    fi
    vec=$(embed_text "$text" || true)
    if [ -z "$vec" ]; then
      echo "[worklogs] embed failed for $id"
      fail=$((fail + 1))
      continue
    fi
    update_worklog_embedding "$id" "$vec"
    ok=$((ok + 1))
    printf "."
  done
  echo
  echo "[worklogs] done — ok=$ok, fail=$fail (total=$total)"
}

case "$target" in
  all) backfill_posts; backfill_worklogs ;;
  posts) backfill_posts ;;
  worklogs) backfill_worklogs ;;
  *) echo "Usage: $0 [all|posts|worklogs]"; exit 1 ;;
esac
