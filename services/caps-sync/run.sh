#!/bin/sh
# 캡스→ERP 근태 증분 동기화 (cron 10분 주기). 캡스 PC가 꺼져 있으면 그 회차만 실패하고 다음 회차가 따라잡음.
cd /home/oceantech/ERP_OT/services/caps-sync || exit 1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') incremental ==="
/usr/bin/node sync.js
echo ""
