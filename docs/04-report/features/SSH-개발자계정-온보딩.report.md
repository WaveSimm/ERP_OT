# 사내 개발자 SSH 계정 온보딩 (Report)

**일자**: 2026-06-25 | **대상**: 서버 OS(192.168.0.41)

## 구현
- **kimny**: 계정 생성 + 공개키 등록(ed25519), `docker,sudo` 그룹, `/home/oceantech` 전체 ACL(setfacl rwX + default).
- 트러블슈팅: authorized_keys CRLF(`tr -d '\r'`), 패스프레이즈 분실→무패스프레이즈 키 재발급, 키지문 대조(SHA256). 접속 성공.

## 잔여
- **wltnchoi** 미완: `usermod -aG docker,sudo`, setfacl, passwd, 키 검증 (사용자 터미널에서 sudo 실행 필요 — Claude 세션은 TTY 없어 불가).
