# ERP DR Failover 런북 (.41 → .42)

> 운영서버 **`.41`(192.168.0.41, eno4)** 하드웨어 장애 시, 백업/대체 서버
> **`.42`(192.168.0.42, eno1)** 가 ERP 핵심 업무를 대체 가동하기 위한 절차서.
> 최종 갱신: 2026-07-01 · 리허설 검증: (미실시 — 데이터복원·로그인은 실증 완료)

---

## 0. 범위 · 원칙

- **대체 범위**: ERP 핵심(auth, user, project, attendance, approval, equipment, expense, web + postgres/redis/rabbitmq).
- **제외**: OCR(ocr-service/engine), OT-Brain(지식·NAS검색, ollama, reranker, knowledge-api). → 장애 중 지식검색/OCR은 중단(데이터는 백업 보존).
- **전환 방식**: 사내 PC가 `192.168.0.41` 고정 IP 직접접속 → **`.42`가 `192.168.0.41` IP를 승계**(클라이언트 무변경).
- **RPO ≈ 10분**(10분 주기 논리덤프 동기화). **RTO 목표**: 이미지 사전빌드 완료 상태이므로 web 재빌드(수분) + 복원 포함 대략 10~20분(리허설로 실측 필요).
- ⚠️ **Split-brain 금지**: `.42`가 `.41` IP를 잡기 전에 **`.41`이 확실히 죽었는지(또는 네트워크에서 분리됐는지)** 반드시 확인. 둘 다 살아있으면 IP 충돌.

## 사전 상시 준비 상태(평상시 유지)

| 항목 | 상태 |
|---|---|
| Docker/Compose, repo+`.env` | `.42:~/ERP_OT` 배치됨 |
| ERP 이미지(베이스2+서비스7) | `.42`에 빌드됨(대기, 컨테이너 0) |
| 데이터 동기화 | `.41` cron `*/10` → `.42:~/erp-dr/` (DB `--clean`덤프 + 업로드볼륨) |
| NAS 마운트 | `.42:/mnt/nas/oceantech` (fstab, 재부팅 자동) |
| Failover 스크립트 | `.42:~/dr-failover.sh` |

---

## 1. 장애 감지 · 판단

- 사내에서 ERP 접속 불가 신고 / 모니터링 알림.
- `.41` 상태 확인: `ping 192.168.0.41`, 콘솔/전원/디스크 상태.
- **판단**: `.41` 하드웨어 복구가 단시간(수십분) 내 불가 → Failover 개시.

## 2. `.41` 완전 차단 (Split-brain 방지)

- `.41`이 살아있으나 비정상이면, IP 충돌 방지를 위해 **`.41` 전원 차단 또는 LAN 케이블 분리**.
- 완전 다운(하드웨어 장애)이면 이 단계는 자동 충족.

## 3. `.42` ERP 스택 기동 (데이터 복원 포함)

```bash
ssh oceantech@192.168.0.42
~/dr-failover.sh        # 인프라기동 → 최신 --clean 덤프 복원 → 업로드볼륨 복원 → 앱서비스 기동
# 로그: ~/dr-failover.log
```
스크립트가 마지막에 **복원 사용자 수**와 **web HTTP 200**을 출력.

## 4. 기동 검증 (IP 승계 前)

```bash
# .42 자기 IP로 먼저 확인
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.42:3000/         # 200 기대
ssh oceantech@192.168.0.42 'docker exec erp-ot-postgres psql -U erp_user -d erp_ot -tAc "select count(*) from auth_users"'  # 1 이면 복원 실패!
```
- 사용자 수가 **1(seed admin만)** 이면 복원 실패 → §부록 A 참고(앱 정지→재복원).
- NAS 확인: `ssh oceantech@192.168.0.42 'ls /mnt/nas/oceantech | head'`

## 5. IP 승계 (`.42` eno1 에 192.168.0.41 추가)

```bash
ssh oceantech@192.168.0.42
sudo nmcli connection modify netplan-eno1 +ipv4.addresses 192.168.0.41/16
sudo nmcli connection up netplan-eno1
ip addr show eno1 | grep 192.168.0.41           # 확인
```
- IP 추가 시 **gratuitous ARP** 발생 → 스위치·사내 PC가 새 MAC 자동 학습.
- (`.42` 자체 관리용 192.168.0.42 는 유지되어 SSH 접속 계속 가능)

## 6. 최종 확인

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.0.41:3000/         # 사내 접속 경로 200
```
- 사내 PC 1~2대에서 실제 로그인·주요 화면(프로젝트/근태/결재) 확인.

---

## 7. Failback (`.41` 복구 후 원복)

> `.42`에서 운영 중 발생한 데이터가 최신이므로 **`.42` → `.41` 역방향 복원**이 먼저.

1. `.41` 하드웨어 복구 + 기존 스택 기동 금지(빈 상태 유지).
2. **`.42` 최신 데이터 덤프 → `.41` 복원**:
   ```bash
   ssh oceantech@192.168.0.42 'docker exec erp-ot-postgres pg_dump -U erp_user -d erp_ot --no-owner --no-privileges --clean --if-exists | gzip' > /tmp/failback.sql.gz
   # .41 로 옮겨 복원 (.41 앱서비스 정지 상태에서)
   gunzip -c /tmp/failback.sql.gz | docker exec -i erp-ot-postgres psql -q -U erp_user -d erp_ot
   # 업로드 볼륨도 .42 → .41 rsync/tar 복원
   ```
3. **IP 원복**: `.42` 에서 `.41` IP 회수 →
   ```bash
   ssh oceantech@192.168.0.42 'sudo nmcli connection modify netplan-eno1 -ipv4.addresses 192.168.0.41/16 && sudo nmcli connection up netplan-eno1'
   ```
4. `.41` 스택 기동 + `192.168.0.41` 정상 확인.
5. `.42` 스택 정지(`docker compose down`) → 대기상태 복귀. 10분 동기화 cron 재개 확인.

---

## 부록 A. 복원 사용자 수가 1인 경우 (데이터 유실 방지)

원인: plain 덤프/순서 문제로 seed(admin@erp-ot.local)만 남음. 반드시 `--clean` 덤프로 앱 정지 상태에서 재복원.
```bash
ssh oceantech@192.168.0.42
cd ~/ERP_OT
docker compose stop auth-service user-service project-service attendance-service approval-service equipment-service expense-service web
CLEAN=$(ls -t ~/erp-dr/db/erp_ot_*.sql.gz | head -1)
gunzip -c "$CLEAN" | docker exec -i erp-ot-postgres psql -q -U erp_user -d erp_ot
docker exec erp-ot-postgres psql -U erp_user -d erp_ot -tAc "select count(*) from auth_users"   # 71 확인
docker compose up -d --no-deps auth-service user-service project-service attendance-service approval-service equipment-service expense-service web
```

## 부록 B. 참고 정보

| 구분 | .41 (운영) | .42 (대체) |
|---|---|---|
| IP / IF | 192.168.0.41 / eno4 | 192.168.0.42 / eno1 (NM: `netplan-eno1`) |
| CPU/RAM | 24스레드 / 30G | 4스레드 / 15G (ERP 풀스택 검증됨) |
| 게이트웨이 | 192.168.0.1 | 192.168.0.1 |
| DB | erp_ot (스키마분리, 전 ERP 공유) | 복원본 |
| NAS | //192.168.0.220/oceantech (yssim) | 동(otbrain-scan, 동일 뷰) |

## 미결 / 개선

- **리허설 미실시**: IP 승계 포함 실제 전환 리허설로 RTO 실측 필요(운영 .41 조율).
- otbrain 17GB 주간덤프 미설정.
- `.42` 단일 구형 HDD·무RAID → SMART 모니터링 권장.
