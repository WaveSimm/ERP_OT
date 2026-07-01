# 호스트 운영 스크립트 백업 (snapshot)

서버(`/home/oceantech/`)에서 cron으로 도는 운영 스크립트의 **백업 스냅샷**입니다.
git 밖(호스트)에 있어 유실 위험이 있어 여기에 보관합니다. 비밀(.env, /etc/nas-cred)은 포함하지 않습니다.

## 포함 파일 (라이브 위치: `/home/oceantech/`)
| 파일 | 역할 | cron |
|---|---|---|
| `erp-nas-backup.sh` | DB·업로드·env NAS 백업 | daily 00:00 / weekly 일 05:00 |
| `nas-uploader.sh` | 백업 NAS 업로드(컨테이너 실행) | (위에서 호출) |
| `nas-poll.sh` | NAS 증분 스캔(DSM API) | */5분 |
| `nas-extract.sh` | 문서 추출·청킹·임베딩 | 매일 03:00 |
| `nas-reconcile.sh` | NAS 정합성 정리 | 토 08:00 |
| `disk-monitor.sh` | 디스크 사용량 감시·알림 | */10분 |
| `ops-notifier.sh` | 알림 큐 메일 발송 | */1분 |
| `ops-lib.sh` | ops 공통 헬퍼(source용) | - |
| `exif-start.sh` / `exif-stop.sh` | 야간 EXIF 워커 기동/종료 | 20:00 / 08:00 |
| `migrate-containerd.sh` | (1회성) containerd /data 이전 | - |
| `crontab.txt` | 위 cron 스케줄 스냅샷 | - |
| `git-hooks/post-commit` | 커밋 시 '업데이트' 게시판 자동 등록 훅 | - |

## 복원
1. 파일을 `/home/oceantech/`로 복사, `chmod +x *.sh`
2. `crontab crontab.txt`로 cron 복원
3. `git-hooks/post-commit` → `ERP_OT/.git/hooks/post-commit` (chmod +x)
4. 비밀은 별도: `/home/oceantech/.disk-monitor.env`(SMTP), `/etc/nas-cred`(NAS) 재생성

## 주의
- 이건 **스냅샷**이라 라이브 스크립트 변경 시 다시 커밋해야 최신 유지됩니다.
  (또는 erp-nas-backup.sh 일일 백업에 `*.sh` 포함하면 NAS에 자동 최신 보관)
