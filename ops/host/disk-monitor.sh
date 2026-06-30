#!/bin/bash
# ── 디스크 사용량 모니터 (ops 알림 프레임워크의 첫 모니터) ───────────────────────
#   /data(sdb2)·/(sda2) 사용률 감시. 임계 초과 시 ops.alert_event 에 이벤트 기록 →
#   호스트 notifier(ops-notifier.sh, cron 1분)가 메일 발송. 임계치·활성여부는
#   erp_ot.ops.monitor(key='disk').config 에서 읽어 admin UI 에서 조정 가능.
#   배경: 2026-06-30 /data 포화→ot-postgres PANIC 사고 후 설치된 조기경보.
#   스팸방지: 상태변화 시 + 지속 시 재기록(WARN 1h/CRIT 15m). 회복은 기록만(메일X).
#   폴백: DB 기록 실패(DB 다운) 시 WARN/CRIT 는 호스트 curl 로 직접 발송(유실 방지).
#   주기: cron */10. 테스트: `disk-monitor.sh --test` → TEST 이벤트 1건 큐에 적재.
set -uo pipefail

LOG=/home/oceantech/disk-monitor.log
STATE=/home/oceantech/.disk-monitor.state
ENVF=/home/oceantech/.disk-monitor.env      # 폴백 발송용 SMTP 비밀(권한 600)
OPSLIB=/home/oceantech/ops-lib.sh
WARN_DEFAULT=85; CRIT_DEFAULT=92
REALERT_WARN=3600; REALERT_CRIT=900

[ -f "$ENVF" ] && . "$ENVF"
[ -f "$OPSLIB" ] && . "$OPSLIB"
NOW=$(date +%s); TS=$(date '+%F %T %Z')

# ── 폴백 직접 발송(DB 불가 시에만) ──
send_email_fallback() {
  [ -n "${SMTP_PASS:-}" ] || return 0
  local subject=$1 body=$2 from=${SMTP_FROM:-${SMTP_USER:-}} to=${SMTP_TO:-${SMTP_USER:-}}
  [ -n "$from" ] && [ -n "$to" ] || return 0
  printf 'From: ERP Disk Monitor <%s>\nTo: %s\nSubject: %s\nDate: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n' \
    "$from" "$to" "$subject" "$(date -R)" "$body" \
  | curl -s --ssl-reqd --max-time 25 --url "${SMTP_HOST:-smtp://mail.oceantech.co.kr:25}" \
        --user "$SMTP_USER:$SMTP_PASS" --mail-from "$from" --mail-rcpt "$to" -T - >>"$LOG" 2>&1 \
    && echo "[$TS] [MAIL-FALLBACK] sent: $subject" >>"$LOG" \
    || echo "[$TS] [MAIL-FAIL] $subject" >>"$LOG"
}

# ── 이벤트 기록(우선) + 폴백 ──
record() {            # record <level> <mount> <pct> <detail>
  local level=$1 mnt=$2 pct=$3 detail=$4
  echo "[$TS] [$level] $mnt ${pct}% — $detail" >> "$LOG"
  local notify=false; case "$level" in WARN|CRIT) notify=true;; esac
  if command -v ops_emit >/dev/null 2>&1 && \
     ops_emit "disk" "$level" "$mnt" "$mnt ${pct}% — $detail" "$notify"; then
    return 0
  fi
  # DB 기록 실패 → WARN/CRIT 만 폴백 발송
  [ "$notify" = true ] && send_email_fallback "[DISK $level] $mnt ${pct}% ($(hostname))" \
"[$TS] $mnt ${pct}% ($level)
$detail
호스트: $(hostname)  (DB 기록 실패 → 폴백 발송)"
}

# ── 테스트 모드: 큐에 TEST 이벤트 적재(notifier 가 발송) ──
if [ "${1:-}" = "--test" ]; then
  if command -v ops_emit >/dev/null 2>&1 && \
     ops_emit "disk" "TEST" "" "디스크 알람 테스트 — notifier 큐 발송 확인 ($(hostname), $TS)" "true"; then
    echo "TEST 이벤트 적재 완료 — ops-notifier 가 1분 내 발송. $LOG / 받은편지함 확인"; exit 0
  else
    echo "DB 기록 실패 — ops-lib/DB 확인 필요"; exit 1
  fi
fi

# ── 활성/임계 설정 로드(DB, 폴백 기본값) ──
ENABLED=$(command -v ops_monitor_enabled >/dev/null 2>&1 && ops_monitor_enabled disk || echo "")
[ "$ENABLED" = "f" ] && { echo "[$TS] [SKIP] disk 모니터 비활성(ops.monitor)" >> "$LOG"; exit 0; }
WARN=$(command -v ops_config_num >/dev/null 2>&1 && ops_config_num disk warn $WARN_DEFAULT || echo $WARN_DEFAULT)
CRIT=$(command -v ops_config_num >/dev/null 2>&1 && ops_config_num disk crit $CRIT_DEFAULT || echo $CRIT_DEFAULT)
MOUNTS=$(ops_pg "SELECT jsonb_array_elements_text(config->'mounts') FROM ops.monitor WHERE key='disk';" 2>/dev/null)
[ -z "$MOUNTS" ] && MOUNTS=$'/data\n/'

prev_for() { grep -E "^$1 " "$STATE" 2>/dev/null | tail -1; }
touch "$STATE"
NEWSTATE=""
while IFS= read -r mnt; do
  [ -z "$mnt" ] && continue
  read -r pct avail <<<"$(df -P "$mnt" 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5" "$4}')"
  [ -z "${pct:-}" ] && { echo "[$TS] [ERROR] $mnt df 실패" >> "$LOG"; continue; }

  if   [ "$pct" -ge "$CRIT" ]; then level="CRIT"; interval=$REALERT_CRIT
  elif [ "$pct" -ge "$WARN" ]; then level="WARN"; interval=$REALERT_WARN
  else level="OK"; interval=0; fi

  prev=$(prev_for "$mnt"); prev_level=$(echo "$prev" | awk '{print $2}'); prev_epoch=$(echo "$prev" | awk '{print $3}')
  : "${prev_level:=OK}"; : "${prev_epoch:=0}"; last_alert=$prev_epoch

  if [ "$level" != "OK" ]; then
    if [ "$level" != "$prev_level" ]; then
      record "$level" "$mnt" "$pct" "가용 ${avail}KB (임계 WARN${WARN}/CRIT${CRIT})"; last_alert=$NOW
    elif [ $((NOW - prev_epoch)) -ge "$interval" ]; then
      record "$level" "$mnt" "$pct" "지속 — 가용 ${avail}KB"; last_alert=$NOW
    fi
  elif [ "$prev_level" != "OK" ]; then
    record "RECOVER" "$mnt" "$pct" "정상 복귀(가용 ${avail}KB)"
  fi
  NEWSTATE+="$mnt $level $last_alert"$'\n'
done <<< "$MOUNTS"

printf '%s' "$NEWSTATE" > "$STATE"
