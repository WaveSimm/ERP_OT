/**
 * 회사 정보 — 보고서·문서 출력용 정적 상수.
 *
 * 회사 이전·이름 변경 시 이 파일만 수정하면 보고서 전체에 반영됨.
 *
 * 향후 확장 후보: 사업자등록번호, 대표자, 전화/팩스, 이메일,
 * 로고 이미지 (현재는 텍스트만).
 */

export const COMPANY_INFO = {
  /** 영문/브랜드명 (보고서 헤더에 텍스트 폴백) */
  name: "OCEANTECH",
  /** 한글 정식 명칭 */
  nameKor: "주식회사 오션테크",
  /** 영문 주소 (보고서 풋터) */
  address: "OCEAN Bldg. 57 Haengjusanseong-ro 144Beon-Gil, Goyang-si, Gyeonggi-do, Korea",
  /** 한글 주소 */
  addressKor: "경기도 고양시 행주산성로 144번길 57 OCEAN 빌딩",
  /** 로고 이미지 경로 (apps/web/public/) — 보고서 헤더에 표시 */
  logoUrl: "/oceantech-logo.png",
} as const;
