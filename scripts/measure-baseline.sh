#!/usr/bin/env bash
# 성능 베이스라인 측정 — 읽기 전용·무부하(운영 서버 안전).
#   서버에서: bash scripts/measure-baseline.sh
#   결과는 scripts/baseline-results/<timestamp>.txt 에 저장(추세 비교용).
#
# 측정 항목:
#   ① 백엔드 8서비스 /health 응답시간 (인프라 기초 속도)
#   ② ollama bge-m3 임베딩 콜드/웜 (검색 파이프라인)
#   ③ web 주요 페이지 응답시간 (dev 모드 — 첫 진입=컴파일 / 재진입=웜)
#
# 주의: dev 모드 web·콜드/웜 편차로 단일값보다 "추세"로 볼 것. 자주 쓰면 웜 유지됨.

set -uo pipefail
cd "$(dirname "$0")/.."

TS=$(date +%Y%m%d-%H%M%S)
OUT_DIR="scripts/baseline-results"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/$TS.txt"

# host(타임스탬프는 인자로 받지 않고 date 사용 — 스크립트라 OK)
{
  echo "# 성능 베이스라인 — $TS"
  echo ""

  echo "## ① 백엔드 /health (code time)"
  for p in 3001:auth 3002:user 3003:project 3004:attendance \
           3005:equipment 3006:approval 3007:ocr 3008:expense; do
    port=${p%%:*}; name=${p##*:}
    r=$(curl -s -o /dev/null --max-time 5 -w "%{http_code} %{time_total}s" \
        "http://localhost:$port/health" 2>/dev/null || echo "000 timeout")
    printf "  %-12s(%s): %s\n" "$name" "$port" "$r"
  done
  echo ""

  echo "## ② ollama bge-m3 임베딩 (1=콜드, 2·3=웜)"
  for i in 1 2 3; do
    t=$(curl -s -o /dev/null --max-time 30 -w "%{time_total}" \
        http://localhost:11434/api/embeddings \
        -d '{"model":"bge-m3","prompt":"어항 정비 공사 계약 진행 현황"}' 2>/dev/null || echo "timeout")
    echo "  embed $i: ${t}s"
  done
  echo ""

  echo "## ③ web 페이지 (dev 모드)"
  for path in / /home /login; do
    r=$(curl -s -o /dev/null --max-time 30 -w "%{http_code} %{time_total}s" \
        "http://localhost:3000$path" 2>/dev/null || echo "000 timeout")
    printf "  %-8s: %s\n" "$path" "$r"
  done
} | tee "$OUT"

echo ""
echo "→ 저장: $OUT"
