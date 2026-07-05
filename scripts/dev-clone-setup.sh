#!/bin/bash
# ── 개발자 개인 클론 셀프 세팅 (최초 1회) ──────────────────────────────────────
#   각 개발자가 "자기 계정으로 SSH 접속한 뒤" 실행:
#     bash /home/oceantech/ERP_OT/scripts/dev-clone-setup.sh
#   하는 일: ~/ERP_OT 클론 + git 사용자 설정 + pnpm install
#   문서: docs/04-operation/개발워크플로우-개인클론-분리.md
set -euo pipefail

REPO_URL="https://github.com/WaveSimm/ERP_OT.git"
DEST="$HOME/ERP_OT"

if [ "$(whoami)" = "oceantech" ]; then
  echo "[중단] oceantech은 배포 계정입니다. 개발자 본인 계정으로 실행하세요."
  exit 1
fi

if [ -d "$DEST/.git" ]; then
  echo "[skip] $DEST 클론이 이미 있습니다."
else
  echo "[1/3] 클론: $REPO_URL → $DEST"
  git clone "$REPO_URL" "$DEST"
fi

cd "$DEST"

if [ -z "$(git config user.name || true)" ]; then
  read -rp "[2/3] git 이름(커밋 표시용): " GIT_NAME
  read -rp "      git 이메일(GitHub 계정 이메일): " GIT_EMAIL
  git config user.name "$GIT_NAME"
  git config user.email "$GIT_EMAIL"
else
  echo "[skip] git 사용자 설정 완료됨: $(git config user.name) <$(git config user.email)>"
fi

echo "[3/3] 의존성 설치 (pnpm install)"
if command -v pnpm >/dev/null; then
  pnpm install
else
  echo "  ! pnpm 없음 — 'npm install -g pnpm' 후 pnpm install 을 직접 실행하세요."
fi

cat <<'EOF'

── 세팅 완료. 작업 흐름 ────────────────────────────────────────────
  cd ~/ERP_OT
  git checkout master && git pull
  git checkout -b feat/작업-요약        # 브랜치에서 작업
  ...수정/커밋... (Claude CLI도 이 폴더에서 실행)
  git push -u origin feat/작업-요약     # push 후 GitHub에서 PR 생성
주의:
  - /home/oceantech/ERP_OT (배포 트리)는 읽기 전용 — 직접 수정 금지
  - GitHub push에는 본인 GitHub 인증 필요 (gh auth login 또는 PAT)
  - 개인 dev 포트: 문서의 배정표 참조 (kimny 3120대 / wltnchoi 3140대)
────────────────────────────────────────────────────────────────────
EOF
