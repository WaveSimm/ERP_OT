# phones — 내선번호/계정 마이그레이션 입력

- **대응 스크립트**: `scripts/update-phones.mjs`
- **파일**: `26년5월 _내선번호 .pdf` — **출처 참고용**. 스크립트는 PDF를 읽지 않으며,
  실제 데이터는 스크립트 내 `ENTRIES` 배열에 하드코딩돼 있습니다. PDF가 갱신되면 ENTRIES를 손으로 갱신.
- **실행**(auth 컨테이너 안에서):
  - dry-run: `docker exec -w /app erp-ot-auth node update-phones.mjs`
  - 실제 적용: `docker exec -w /app erp-ot-auth node update-phones.mjs --apply`
