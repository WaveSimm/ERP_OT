/**
 * 부하테스트 PDCA — project-service 부하 시드
 *
 * 자원-모델-분리 PDCA Phase 3c (2026-05-04): no-op으로 변경.
 *
 * 변경 이유:
 *   - 자원-모델-분리 후 사람은 auth_users 단일 source.
 *   - PERSON Resource 폐기 → 부하테스트가 PERSON Resource 만들 필요 없음.
 *   - dashboard·picker·인력현황 모두 auth_users에서 직접 조회.
 *
 * 향후 부하테스트가 SegmentAssignment(personUserId) 부하를 추가하면
 * 여기서 polymorphic 컬럼으로 시드 생성. 현재는 로그인/게시판/검색 부하만 측정 → 시드 불필요.
 *
 * 환경변수: LOAD_TEST_USER_COUNT (default 90)
 */
async function main() {
  const count = parseInt(process.env.LOAD_TEST_USER_COUNT ?? "90", 10);
  console.log(`[load-seed-project] no-op (자원-모델-분리 PDCA 후 PERSON Resource 폐기). count=${count} (참고만)`);
  console.log(`[load-seed-project] 부하테스트는 auth_users (이미 seed-load-test.ts) + 게시판/검색 부하만 사용.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
