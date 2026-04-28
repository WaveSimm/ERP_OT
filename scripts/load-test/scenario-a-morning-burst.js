// 부하테스트 — 시나리오 A: 출근 burst
// 30초 ramp 60 VU + 1분 유지. 로그인 + 홈 진입 6 API 동시 호출.
// 환경변수: STRESS=true (90 VU 옵션)
import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { SharedArray } from 'k6/data';
import { BASE, authHeaders } from './lib/common.js';

const STRESS = __ENV.STRESS === 'true';
const TARGET = STRESS ? 90 : 60;

const users = new SharedArray('users', () => JSON.parse(open('./users.json')));

export const options = {
  scenarios: {
    morning: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: TARGET },
        { duration: '1m',  target: TARGET },
      ],
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.005'],
    'http_req_duration{name:login}': ['p(95)<800'],
    'http_req_duration{name:home}':  ['p(95)<500'],
  },
};

export default function () {
  const u = users[__VU % users.length];

  // 1. 로그인 (매 iteration마다 새로 — 출근 burst 시뮬)
  const r = http.post(`${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: u.email, password: u.password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
  check(r, { 'login 200': (r) => r.status === 200 });
  if (r.status !== 200) {
    sleep(1);
    return;
  }
  const auth = authHeaders(r.json('accessToken'));

  // 2. 홈 진입: 5개 API 그룹화 (/me는 별도 endpoint 없음, approval은 documents/pending)
  group('home', () => {
    http.get(`${BASE}/api/v1/posts/me/unread-count?categoryCode=notice`, { ...auth, tags: { name: 'home' } });
    http.get(`${BASE}/api/v1/attendance/today`, { ...auth, tags: { name: 'home' } });
    http.get(`${BASE}/api/v1/me/work-log-feed?limit=10`, { ...auth, tags: { name: 'home' } });
    http.get(`${BASE}/api/v1/approval/documents/pending?limit=5`, { ...auth, tags: { name: 'home' } });
    http.get(`${BASE}/api/v1/me/work-log-projects`, { ...auth, tags: { name: 'home' } });
  });

  sleep(1);
}
