#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# containerd 데이터(/var/lib/containerd ≈ 43G, sda2)를 /data(sdb, 3.3T)로 이전.
#   방식: rsync 복사 → 원본 .OLD 보존 → bind mount(/data/containerd → /var/lib/containerd)
#   docker data-root(/data/docker)는 이미 /data. containerd만 옮기면 도커 전체가 /data 사용.
#
# ⚠️ 전체 도커/ERP 서비스 중단(다운타임 ~10~30분) 동반. 유지보수 시간에 실행.
# 실행:  sudo bash /home/oceantech/migrate-containerd.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
SRC=/var/lib/containerd
DST=/data/containerd

log(){ echo -e "\n[$(date '+%H:%M:%S')] $*"; }

[ "$(id -u)" -eq 0 ] || { echo "ERR: root로 실행하세요 (sudo bash ...)"; exit 1; }

log "[1/8] 사전 점검"
[ -d "$SRC" ] || { echo "ERR: $SRC 없음"; exit 1; }
mountpoint -q /data || { echo "ERR: /data 미마운트(sdb)"; exit 1; }
if mountpoint -q "$SRC"; then echo "ERR: $SRC 가 이미 마운트됨(이미 이전됨?). 중단."; exit 1; fi
USED=$(du -sBG "$SRC" 2>/dev/null | cut -f1 | tr -dc 0-9)
AVAIL=$(df -BG --output=avail /data | tail -1 | tr -dc 0-9)
echo "  containerd=${USED}G, /data 여유=${AVAIL}G"
[ "$AVAIL" -gt "$((USED + 20))" ] || { echo "ERR: /data 여유 부족"; exit 1; }

log "[2/8] 현재 컨테이너 수 기록(복귀 검증용)"
BEFORE=$(docker ps -q 2>/dev/null | wc -l || echo "?")
echo "  실행중 컨테이너: $BEFORE"

log "[3/8] 서비스 중단 — 다운타임 시작"
systemctl stop docker docker.socket 2>/dev/null || true
systemctl stop containerd 2>/dev/null || echo "  (containerd 별도 서비스 아님 — 도커 내장)"
sleep 3

log "[4/8] 데이터 복사 (rsync, 권한·xattr 보존)"
mkdir -p "$DST"
rsync -aHAX --numeric-ids "$SRC"/ "$DST"/
echo "  크기 대조 (같아야 정상):"
du -sh "$SRC" "$DST"

log "[5/8] 원본 보존(.OLD) + 빈 마운트포인트 생성"
mv "$SRC" "${SRC}.OLD"
mkdir -p "$SRC"

log "[6/8] fstab bind mount 등록 + 마운트"
if ! grep -qE "^[^#]*$DST[[:space:]]+$SRC[[:space:]]" /etc/fstab; then
  echo "$DST $SRC none bind 0 0" >> /etc/fstab
  echo "  fstab 등록 완료"
fi
mount "$SRC"
mountpoint "$SRC" && echo "  bind mount 활성 (이제 $SRC → $DST = sdb)"

log "[7/8] 서비스 재기동"
systemctl start containerd 2>/dev/null || true
systemctl start docker
sleep 8

log "[8/8] 검증"
echo "  컨테이너 상태:"
docker ps --format '   {{.Names}}: {{.Status}}' 2>/dev/null | head -25
AFTER=$(docker ps -q 2>/dev/null | wc -l || echo "?")
echo "  복귀 컨테이너: $AFTER (이전 $BEFORE)"
echo "  디스크:"
df -h / /data | grep -E 'Filesystem|sda2|sdb2'
echo ""
echo "✅ 이전 완료. 컨테이너가 정상 복귀했고 / 사용량이 줄었으면 성공입니다."
echo "   며칠 무탈하면 회수:  sudo rm -rf ${SRC}.OLD   (sda2 ${USED}G 확정 회수)"
echo "   문제 시 롤백:  sudo systemctl stop docker containerd; sudo umount $SRC; sudo sed -i '\\#$DST $SRC#d' /etc/fstab; sudo rmdir $SRC; sudo mv ${SRC}.OLD $SRC; sudo systemctl start containerd docker"
