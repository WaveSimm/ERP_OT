# ── ops 공통 헬퍼 (호스트 모니터/알림 프레임워크) ───────────────────────────────
#   호스트 모니터 스크립트가 `source` 해서 사용. 이벤트는 erp_ot.ops.alert_event 에
#   기록하고, 발송은 ops-notifier.sh(cron 1분)가 큐를 비우며 전담한다.
#   배경: 컨테이너는 메일서버(25) egress 불가 → 발송은 호스트 전담. 모니터는
#         "감지+이벤트기록"만, notifier가 "발송"만 → 새 모니터는 메일 신경 끔.

OPS_PG_CONTAINER="${OPS_PG_CONTAINER:-erp-ot-postgres}"
OPS_PG_USER="${OPS_PG_USER:-erp_user}"
OPS_PG_DB="${OPS_PG_DB:-erp_ot}"

# 단일 쿼리 실행(값 1개/행 반환). 실패 시 비정상 종료코드.
ops_pg() {
  docker exec "$OPS_PG_CONTAINER" psql -U "$OPS_PG_USER" -d "$OPS_PG_DB" \
    -v ON_ERROR_STOP=1 -qtA -c "$1"
}

# stdin(SQL) 실행.
ops_pg_stdin() {
  docker exec -i "$OPS_PG_CONTAINER" psql -U "$OPS_PG_USER" -d "$OPS_PG_DB" \
    -v ON_ERROR_STOP=1 -qtA
}

# ops_emit <monitor_key> <level> <source> <message> <notify(true|false)>
#   level: INFO|WARN|CRIT|RECOVER|TEST. notify=true 면 notifier가 메일 발송.
#   성공 0, DB 오류 시 비정상 종료코드(호출측에서 폴백 발송 판단).
ops_emit() {
  local mk=$1 lvl=$2 src=$3 msg=$4 notify=${5:-false}
  ops_pg_stdin >/dev/null 2>&1 <<SQL
INSERT INTO ops.alert_event(monitor_key, level, source, message, notify)
VALUES (\$ev\$${mk}\$ev\$, \$ev\$${lvl}\$ev\$, NULLIF(\$ev\$${src}\$ev\$,''), \$ev\$${msg}\$ev\$, ${notify});
SQL
}

# ops_monitor_enabled <key> → "t"/"f"/(빈값=미존재). DB 불가 시 빈값.
ops_monitor_enabled() { ops_pg "SELECT enabled FROM ops.monitor WHERE key='$1';" 2>/dev/null; }

# ops_monitor_config <key> → config jsonb 텍스트. DB 불가 시 빈값.
ops_monitor_config() { ops_pg "SELECT config::text FROM ops.monitor WHERE key='$1';" 2>/dev/null; }

# ops_config_num <key> <jsonkey> <default> → config 의 숫자 필드(없으면 default)
ops_config_num() {
  local v; v=$(ops_pg "SELECT (config->>'$2') FROM ops.monitor WHERE key='$1';" 2>/dev/null)
  case "$v" in ''|*[!0-9]*) echo "$3";; *) echo "$v";; esac
}
