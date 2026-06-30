# 복구 런북 (Disaster Recovery)

백업 위치: NAS `\daily\`(매일, 30일 보존) · `\weekly\`(otbrain, 28일 보존) — `otbrain-scan` 계정.
코드/스크립트: GitHub `WaveSimm/ERP_OT`, `WaveSimm/ot-brain` + NAS `host_ops_*.tar.gz`.

> 표기: `DATE`=백업 날짜(YYYYMMDD). 명령은 서버(우분투)에서 실행.

---

## 0. NAS에서 백업 파일 가져오기
백업은 ro 마운트(`/mnt/nas/oceantech`)와 다른 공유라 smbclient로 받음:
```bash
smbclient '//192.168.0.220/<백업공유>' -A /etc/nas-cred -c 'cd daily; prompt off; mget erp_ot_DATE.sql.gz *_uploads_DATE.tar.gz erp_ot.env otbrain.env host_ops_DATE.tar.gz crontab_DATE.txt post-commit.hook'
smbclient '//192.168.0.220/<백업공유>' -A /etc/nas-cred -c 'cd weekly; get otbrain_DATE.dump'
```
(공유명·경로는 nas-uploader.sh / nas-cred 참조)

## 1. 코드
```bash
cd /home/oceantech
git clone https://github.com/WaveSimm/ERP_OT.git
git clone https://github.com/WaveSimm/ot-brain.git
cd ERP_OT && git checkout feat/trial-release-ui-improvements   # 운영 브랜치
```

## 2. .env (비밀)
```bash
cp erp_ot.env  /home/oceantech/ERP_OT/.env
cp otbrain.env /home/oceantech/ot-brain/.env
```

## 3. 호스트 스크립트 + cron + 훅
```bash
tar xzf host_ops_DATE.tar.gz -C /home/oceantech/   # *.sh 복원
chmod +x /home/oceantech/*.sh
crontab crontab_DATE.txt                            # cron 복원
cp post-commit.hook /home/oceantech/ERP_OT/.git/hooks/post-commit && chmod +x /home/oceantech/ERP_OT/.git/hooks/post-commit
# 비밀 재생성(백업에 미포함): /home/oceantech/.disk-monitor.env(SMTP), /etc/nas-cred(NAS)
```

## 4. 도커 기동 (빈 상태로 먼저)
```bash
cd /home/oceantech/ERP_OT && docker compose build && docker compose up -d
# ot-brain 스택도 동일 (docker compose up -d)
```
DB 컨테이너(ot-postgres, erp-ot-postgres)가 healthy 될 때까지 대기.

## 5. DB 복원
**erp_ot (일일, plain SQL):**
```bash
# 필요시 빈 DB 보장: docker exec -i erp-ot-postgres psql -U erp_user -d postgres -c "DROP DATABASE IF EXISTS erp_ot; CREATE DATABASE erp_ot;"
gunzip -c erp_ot_DATE.sql.gz | docker exec -i erp-ot-postgres psql -U erp_user -d erp_ot
```
**otbrain (주간, custom dump):**
```bash
docker exec -i ot-postgres psql -U otbrain -d postgres -c "DROP DATABASE IF EXISTS otbrain; CREATE DATABASE otbrain;"
docker exec -i ot-postgres pg_restore -U otbrain -d otbrain --no-owner < otbrain_DATE.dump
```
> otbrain은 주간이라 최대 ~7일 stale. 최신화 필요 시 NAS 스캔+추출 재실행(nas-poll/nas-extract)으로 재구축 가능(파생 데이터).

## 6. 업로드 파일 (볼륨 복원)
```bash
for V in auth approval expense ocr; do
  docker run --rm -v "erp_ot_${V}_uploads":/v -i alpine sh -c 'tar xzf - -C /v' < ${V}_uploads_DATE.tar.gz
done
```

## 7. 재기동·검증
```bash
docker compose restart   # 또는 up -d
```
- 로그인 → 프로젝트/근태/게시판 데이터 확인
- 검색이 비면 임베딩 백필 필요할 수 있음(워크로그/게시글) — 참고: docs/메모리

---

## 부분 복구 (서버는 살아있고 데이터만)
- **erp_ot만 되돌리기**: 5번의 erp_ot 절차만 (해당 날짜 sql.gz).
- **특정 업로드만**: 6번에서 해당 볼륨만.
- 운영 중 복구는 사용자 영향 → 점검시간에.

## 주의
- 비밀(.env, .disk-monitor.env, /etc/nas-cred)은 백업에 없음 → 별도 보관/재발급.
- 백업이 NAS 단일지점 → NAS 동시장애 대비 중요 백업(erp_ot.sql.gz)은 오프사이트 사본 권장.
