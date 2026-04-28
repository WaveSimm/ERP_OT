// 부하테스트 — 시나리오 C: 검색 burst
// 30 VU constant 5분. 검색 위주 (자연어 60 + posts 20 + worklogs 20). 동시 임베딩 부하 검증.
// 환경변수: STRESS=true (60 VU)
import http from 'k6/http';
import { sleep, check } from 'k6';
import { SharedArray } from 'k6/data';
import { BASE, pickKeyword, loginCached, authHeaders } from './lib/common.js';

const STRESS = __ENV.STRESS === 'true';
const VUS = STRESS ? 60 : 30;

const users = new SharedArray('users', () => JSON.parse(open('./users.json')));

export const options = {
  scenarios: {
    search_burst: {
      executor: 'constant-vus',
      vus: VUS,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{name:search_all}':      ['p(95)<800'],
    'http_req_duration{name:search_posts}':    ['p(95)<800'],
    'http_req_duration{name:search_worklogs}': ['p(95)<800'],
  },
};

export default function () {
  const u = users[__VU % users.length];
  const token = loginCached(u);
  const auth = authHeaders(token);
  const kw = pickKeyword();

  const r = Math.random();
  if (r < 0.6) {
    http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&scope=all&limit=20`,
      { ...auth, tags: { name: 'search_all' } });
  } else if (r < 0.8) {
    http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&scope=posts&limit=20`,
      { ...auth, tags: { name: 'search_posts' } });
  } else {
    http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&scope=worklogs&limit=20`,
      { ...auth, tags: { name: 'search_worklogs' } });
  }

  // 짧은 think time 0.5~1.5초
  sleep(Math.random() + 0.5);
}
