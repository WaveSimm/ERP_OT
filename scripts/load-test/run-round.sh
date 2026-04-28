#!/usr/bin/env bash
# 부하테스트 — 단일 round 실행 (메트릭 캡처 + k6 + 결과 저장)
#
# Usage:
#   LABEL=round-1-dev-burst bash scripts/load-test/run-round.sh scenario-a-morning-burst.js
#   LABEL=round-5-prod-stress STRESS=true bash scripts/load-test/run-round.sh scenario-b-mixed.js

set -euo pipefail

SCENARIO="${1:?scenario file required}"
LABEL="${LABEL:-default}"
STRESS="${STRESS:-false}"
DURATION="${DURATION:-720}"
BASE_URL="${BASE_URL:-http://host.docker.internal:3000}"

OUT_DIR="docs/04-operation/load-test-results/${LABEL}"
mkdir -p "$OUT_DIR"

# users.json 존재 검증
if [ ! -f scripts/load-test/users.json ]; then
  echo "❌ scripts/load-test/users.json not found"
  echo "   생성: node scripts/load-test/generate-users-json.mjs > scripts/load-test/users.json"
  exit 1
fi

# 시나리오 파일 존재 검증
if [ ! -f "scripts/load-test/$SCENARIO" ]; then
  echo "❌ scripts/load-test/$SCENARIO not found"
  exit 1
fi

echo "=== Round: $LABEL ==="
echo "   Scenario: $SCENARIO"
echo "   STRESS:   $STRESS"
echo "   Duration: ${DURATION}s"
echo "   Output:   $OUT_DIR"

# 메트릭 캡처 백그라운드
bash scripts/load-test/capture-metrics.sh "$DURATION" "$LABEL" &
CAPTURE_PID=$!

# k6 실행
docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$(pwd)/scripts/load-test:/scripts" \
  -e STRESS="$STRESS" \
  -e BASE_URL="$BASE_URL" \
  grafana/k6 run \
    --out json="/scripts/_results.json" \
    --summary-export="/scripts/_summary.json" \
    "/scripts/$SCENARIO" 2>&1 | tee "$OUT_DIR/k6.log"

# 결과 이동
mv scripts/load-test/_results.json "$OUT_DIR/k6-results.json" 2>/dev/null || true
mv scripts/load-test/_summary.json "$OUT_DIR/k6-summary.json" 2>/dev/null || true

# 캡처 종료
kill $CAPTURE_PID 2>/dev/null || true
wait $CAPTURE_PID 2>/dev/null || true

echo "✅ Round $LABEL 완료 → $OUT_DIR"
echo "   파일:"
ls -la "$OUT_DIR" | tail -n +2
