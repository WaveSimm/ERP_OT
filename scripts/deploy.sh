#!/bin/bash
# ── 배포 스크립트 (dirty-guard 포함) ─────────────────────────────────────────
#   사용: scripts/deploy.sh <service>|web|all  [--skip-pull]
#     예: scripts/deploy.sh project-service    # 백엔드 1개
#         scripts/deploy.sh web               # 프론트 (컨테이너 내 빌드 + 재기동)
#   원칙: 배포 트리(/home/oceantech/ERP_OT)는 PR 머지분 pull만 반영.
#         작업 트리가 dirty면 배포 중단 — 누군가 직접 수정했다는 뜻이므로 원인부터 파악.
#   문서: docs/04-operation/개발워크플로우-개인클론-분리.md
set -euo pipefail

cd /home/oceantech/ERP_OT
TARGET="${1:?사용법: deploy.sh <service>|web|all [--skip-pull]}"
SKIP_PULL="${2:-}"

# ── dirty-guard: 무해한 로컬 노이즈(Claude 설정·빌드 아티팩트)만 예외 ──
ALLOW_DIRTY='^(.claude/settings.local.json|apps/web/tsconfig.tsbuildinfo)$'
DIRTY=$(git status --porcelain | awk '{print $2}' | grep -vE "$ALLOW_DIRTY" || true)
if [ -n "$DIRTY" ]; then
  echo "[중단] 배포 트리에 미커밋 변경이 있습니다 — 직접 수정 금지 원칙 위반 여부 확인 필요:"
  echo "$DIRTY" | sed 's/^/  /'
  exit 1
fi

if [ "$SKIP_PULL" != "--skip-pull" ]; then
  echo "[pull] origin/master 반영"
  git pull --ff-only
fi

deploy_web() {
  echo "[web] 컨테이너 내 프로덕션 빌드"
  docker compose exec web sh -c "npm run build"
  echo "[web] 재기동"
  docker compose restart web
  echo "[web] 기동 대기..."
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null || true)
    if [ "$code" = "200" ] || [ "$code" = "307" ]; then echo "[web] UP ($code)"; return 0; fi
    sleep 10
  done
  echo "[web] ! 400초 내 응답 없음 — docker logs erp-ot-web 확인 필요"; return 1
}

deploy_service() {
  local svc="$1"
  echo "[$svc] 이미지 빌드"
  docker compose build "$svc"
  echo "[$svc] 재기동"
  docker compose up -d "$svc"
  sleep 8
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -i "${svc%-service}" || true
}

case "$TARGET" in
  web)  deploy_web ;;
  all)  for s in auth-service user-service project-service attendance-service equipment-service approval-service expense-service; do deploy_service "$s"; done; deploy_web ;;
  *)    deploy_service "$TARGET" ;;
esac

echo "[완료] $(date '+%F %T') — 배포 커밋: $(git log --oneline -1)"
