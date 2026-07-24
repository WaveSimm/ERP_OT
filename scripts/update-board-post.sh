#!/bin/bash
# ── update-board-post.sh: '업데이트' 게시판(feature-update) 배포 시점 등록 ────
#   마지막 등록 포인터(.git/update-board-last-posted)..HEAD 의 비머지 커밋을
#   board_posts 에 등록하고 포인터를 HEAD 로 옮긴다. 몇 번을 실행해도 중복이
#   나지 않는 멱등 구조 — deploy.sh·post-merge 훅·수동 실행이 겹쳐도 안전.
#
#   호출 지점:
#     1) scripts/deploy.sh — pull 직후 (정식 배포 경로)
#     2) scripts/git-hooks/post-merge — 수동 git pull 안전망
#   운영 DB(erp-ot-postgres)가 없는 환경(개발 PC)에서는 조용히 통과한다.
#   24시간 내 같은 제목 글은 새 글 대신 최신 내용으로 갱신(업서트, 2차 방어).
#   등록 실패 커밋이 있으면 포인터를 옮기지 않아 다음 실행에서 재시도된다.
set -uo pipefail

BOARD="bfd8881c-2ae3-42e9-b50b-fb2378e333de"   # 업데이트 보드
AUTHOR="dev-admin-001"                          # 개발자
PGC="erp-ot-postgres"

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
GD=$(git rev-parse --git-dir 2>/dev/null || echo .git)
PTR="$GD/update-board-last-posted"

# 운영 DB 컨테이너 없으면 통과 (개발 PC 등)
docker inspect "$PGC" >/dev/null 2>&1 || exit 0

HEAD_HASH=$(git rev-parse HEAD)

# 최초 실행: 포인터가 없으면 HEAD 로 초기화만 (과거 이력 일괄 등록 방지)
if [ ! -f "$PTR" ]; then
  echo "$HEAD_HASH" > "$PTR"
  echo "[update-board] 포인터 초기화(${HEAD_HASH:0:7}) — 등록 없음"
  exit 0
fi

LAST=$(cat "$PTR")
# 포인터가 가리키는 커밋이 사라졌으면(강제 이력 변경 등) HEAD 로 재초기화
if ! git cat-file -e "$LAST" 2>/dev/null; then
  echo "$HEAD_HASH" > "$PTR"
  echo "[update-board] 포인터 유실 — ${HEAD_HASH:0:7} 로 재초기화, 등록 없음"
  exit 0
fi

[ "$LAST" = "$HEAD_HASH" ] && exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "-")
POSTED=0
FAILED=0

for h in $(git log --no-merges --reverse --pretty=%H "$LAST..$HEAD_HASH"); do
  subj=$(git log -1 --pretty=%s "$h")
  body=$(git log -1 --pretty=%b "$h")
  short=$(git rev-parse --short "$h")

  # conventional-commit 유형 → 한글 머리말
  ctype=$(printf '%s' "$subj" | grep -oE '^[a-z]+' | head -1)
  case "$ctype" in
    feat)                        tag="추가";;
    fix)                         tag="디버깅";;
    refactor|perf|improve|style) tag="개선";;
    *)                           tag="기타";;
  esac

  clean=$(printf '%s' "$subj" | sed -E 's/^[a-z, ]+(\([^)]*\))?!?:[[:space:]]*//')
  title="[$tag] $clean"
  content="$clean"
  [ -n "$body" ] && content="$content"$'\n\n'"$body"
  content="$content"$'\n\n'"(커밋 $short · 브랜치 $branch)"

  if docker exec -i "$PGC" psql -U erp_user -d erp_ot -q \
    -v ON_ERROR_STOP=1 -v board="$BOARD" -v author="$AUTHOR" -v title="$title" -v content="$content" \
    >/dev/null 2>&1 <<'SQL'
WITH existing AS (
  SELECT id FROM public.board_posts
  WHERE board_id = :'board' AND title = :'title'
    AND created_at >= now() - interval '24 hours'
  ORDER BY created_at DESC LIMIT 1
), updated AS (
  UPDATE public.board_posts
  SET content = :'content', updated_at = now()
  WHERE id IN (SELECT id FROM existing)
  RETURNING id
)
INSERT INTO public.board_posts (id, board_id, author_id, title, content, published_at, created_at, updated_at)
SELECT gen_random_uuid()::text, :'board', :'author', :'title', :'content', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM existing);
SQL
  then
    POSTED=$((POSTED+1))
  else
    FAILED=$((FAILED+1))
    echo "[update-board] ! 등록 실패: $short $subj"
  fi
done

if [ "$FAILED" -eq 0 ]; then
  echo "$HEAD_HASH" > "$PTR"
  echo "[update-board] ${POSTED}건 등록 (${LAST:0:7}..${HEAD_HASH:0:7})"
else
  echo "[update-board] ${POSTED}건 등록·${FAILED}건 실패 — 포인터 유지(다음 실행에서 재시도)"
fi
exit 0
