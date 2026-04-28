// 부하테스트 — k6 공통 유틸 (인증 캐싱, 키워드 풀)
import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://host.docker.internal:3000';

export const KEYWORDS = [
  "디버깅", "메인보드", "회의", "분석", "테스트", "프로젝트", "장비",
  "문서", "수리", "납품", "검수", "점검", "센서", "보고서", "현장",
  "출장", "휴가", "결재", "공지", "자료", "메모", "기획", "설계",
  "구매", "재고",
];

export function pickKeyword() {
  return KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
}

// VU별 토큰 캐시 — 매 iteration마다 로그인 안 하도록
const tokenCache = {};

export function loginCached(user) {
  const cached = tokenCache[user.id];
  if (cached) return cached;

  const r = http.post(`${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
  check(r, { 'login 200': (r) => r.status === 200 });
  if (r.status !== 200) {
    throw new Error(`login failed for ${user.id}: ${r.status} ${r.body}`);
  }
  const token = r.json('accessToken');
  tokenCache[user.id] = token;
  return token;
}

export function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}
