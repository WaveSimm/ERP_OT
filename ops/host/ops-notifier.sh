#!/bin/bash
# ── ops 알림 notifier (호스트 전담 발송) ────────────────────────────────────────
#   ops.alert_event 에서 (notify=true AND notified_at IS NULL) 미발송 이벤트를 꺼내
#   활성 수신자(ops.alert_recipient)에게 메일 발송 후 notified_at 기록.
#   컨테이너는 메일서버(25) egress 불가 → 발송은 이 호스트 스크립트가 전담.
#   주기: cron */1(테스트·알림을 1분 내 전달). SMTP 비밀은 .disk-monitor.env(600).
set -uo pipefail

LOG=/home/oceantech/ops-notifier.log
ENVF=/home/oceantech/.disk-monitor.env
OPSLIB=/home/oceantech/ops-lib.sh
LOCK=/tmp/ops-notifier.lock

exec 9>"$LOCK"; flock -n 9 || exit 0   # 중복 실행 방지
[ -f "$ENVF" ] && . "$ENVF"
[ -f "$OPSLIB" ] && . "$OPSLIB" || { echo "$(date '+%F %T') ops-lib 없음" >>"$LOG"; exit 1; }
TS() { date '+%F %T %Z'; }

# 미발송 이벤트(최대 50) — 필드 구분=US(\x1f, 비공백: 빈 source 도 보존). 탭은 공백류라 빈 필드가 붕괴됨.
PENDING=$(ops_pg "SELECT id||E'\x1f'||level||E'\x1f'||monitor_key||E'\x1f'||coalesce(source,'')||E'\x1f'||replace(message,E'\n',' ')
  FROM ops.alert_event WHERE notify=true AND notified_at IS NULL ORDER BY created_at LIMIT 50;" 2>/dev/null)
[ -z "$PENDING" ] && exit 0

# 활성 이메일 수신자
RCPTS=$(ops_pg "SELECT address FROM ops.alert_recipient WHERE channel='email' AND enabled=true;" 2>/dev/null)
if [ -z "$RCPTS" ]; then
  echo "[$(TS)] [SKIP] 활성 수신자 없음 — 대기 이벤트 보류" >>"$LOG"; exit 0
fi
if [ -z "${SMTP_PASS:-}" ]; then
  echo "[$(TS)] [SKIP] SMTP_PASS 미설정 — 대기 이벤트 보류" >>"$LOG"; exit 0
fi
FROM=${SMTP_FROM:-${SMTP_USER:-}}; HOST=${SMTP_HOST:-smtp://mail.oceantech.co.kr:25}

send_one() {   # send_one <to> <subject> <body>
  local to=$1 subject=$2 body=$3
  printf 'From: ERP Ops Monitor <%s>\nTo: %s\nSubject: %s\nDate: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n' \
    "$FROM" "$to" "$subject" "$(date -R)" "$body" \
  | curl -s --ssl-reqd --max-time 25 --url "$HOST" --user "$SMTP_USER:$SMTP_PASS" \
      --mail-from "$FROM" --mail-rcpt "$to" -T - >>"$LOG" 2>&1
}

while IFS=$'\x1f' read -r id level monitor source message; do
  [ -z "$id" ] && continue
  subject="[OPS $level] ${monitor}${source:+ $source} ($(hostname))"
  body="[$(TS)] $message
모니터: $monitor   레벨: $level${source:+   대상: $source}
호스트: $(hostname)"
  ok=1
  while IFS= read -r to; do
    [ -z "$to" ] && continue
    send_one "$to" "$subject" "$body" || ok=0
  done <<< "$RCPTS"
  if [ "$ok" = 1 ]; then
    ops_pg "UPDATE ops.alert_event SET notified_at=now() WHERE id='$id';" >/dev/null 2>&1
    echo "[$(TS)] [SENT] $level $monitor $source → $(echo "$RCPTS" | tr '\n' ',' )" >>"$LOG"
  else
    echo "[$(TS)] [FAIL] $level $monitor $source (다음 주기 재시도)" >>"$LOG"
  fi
done <<< "$PENDING"
