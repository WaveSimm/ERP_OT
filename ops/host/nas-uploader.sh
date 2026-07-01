#!/bin/sh
# 컨테이너(alpine) 내부 실행 전용. STAGE(/s)의 파일들을
# NAS \\192.168.0.220\erp-backup\<서브폴더> 로 업로드 + 보존일수 경과분 정리.
# 인자: $1=서브폴더(daily|weekly)  $2=보존일수
# 마운트: /cred(smbclient -A 자격증명, ro), /s(스테이징, ro)
set -u
SUB="$1"; RETAIN="$2"
NAS="//192.168.0.220/erp-backup"
apk add --no-cache samba-client >/dev/null 2>&1
SC(){ smbclient "$NAS" -A /cred "$@"; }

SC -c "mkdir $SUB" >/dev/null 2>&1

# 업로드
for f in /s/*; do
  [ -e "$f" ] || continue
  n=$(basename "$f")
  SC -c "cd $SUB; put /s/$n $n" 2>&1 | grep -iE "putting|NT_STATUS" | sed 's/^/  /'
done

# 보존 정리: 파일명 내 YYYYMMDD < cutoff 삭제 (busybox date -d @epoch 사용)
NOW=$(date +%s)
CUTOFF=$(date -d "@$((NOW - RETAIN*86400))" +%Y%m%d 2>/dev/null)
if [ -n "$CUTOFF" ]; then
  SC -c "cd $SUB; ls" 2>/dev/null | awk '{print $1}' | grep -E '_[0-9]{8}\.' | while read -r n; do
    d=$(echo "$n" | grep -oE '[0-9]{8}' | head -1)
    if [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ]; then
      echo "  prune(>${RETAIN}d): $n"
      SC -c "cd $SUB; rm $n" >/dev/null 2>&1
    fi
  done
fi
