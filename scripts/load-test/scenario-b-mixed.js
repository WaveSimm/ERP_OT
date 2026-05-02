// 부하테스트 — 시나리오 B: 평상 mix (10분 soak)
// 60 VU constant 10분. 행동 비율: 게시판/검색 30 + 작업비고 25 + 결재 20 + 프로젝트 15 + 대시보드 10
// 5% write로 임베딩 부하 측정
// 환경변수: STRESS=true (90 VU)
import http from 'k6/http';
import { sleep, check } from 'k6';
import { SharedArray } from 'k6/data';
import { BASE, KEYWORDS, pickKeyword, loginCached, authHeaders } from './lib/common.js';

const STRESS = __ENV.STRESS === 'true';
const VUS = STRESS ? 90 : 60;

const users = new SharedArray('users', () => JSON.parse(open('./users.json')));

export const options = {
  scenarios: {
    mixed: {
      executor: 'constant-vus',
      vus: VUS,
      duration: '10m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.005'],
    'http_req_duration': ['p(95)<500', 'p(99)<2000'],
  },
};

export default function () {
  const u = users[__VU % users.length];
  const token = loginCached(u);
  const auth = authHeaders(token);

  const action = Math.random();

  if (action < 0.30) {
    // 30% 게시판 + 검색
    http.get(`${BASE}/api/v1/boards`, { ...auth, tags: { name: 'board_list' } });
    http.get(`${BASE}/api/v1/posts/feed?categoryCode=notice&limit=20`, { ...auth, tags: { name: 'post_list' } });
    if (Math.random() < 0.5) {
      const kw = pickKeyword();
      http.get(`${BASE}/api/v1/search?q=${encodeURIComponent(kw)}&limit=20`,
        { ...auth, tags: { name: 'search' } });
    }
  } else if (action < 0.55) {
    // 25% 작업비고 (5% 신규 작성 → 임베딩 부하)
    // NOTE: loadtest 사용자는 segment_assignments가 0이라 kanban이 비어 → POST는 실제 실행 안 됨
    //       임베딩 부하 측정이 필요하면 seed-load-test에서 segment_assignments도 시드해야 함
    http.get(`${BASE}/api/v1/me/work-log-feed?limit=20`, { ...auth, tags: { name: 'worklog_feed' } });
    if (Math.random() < 0.2) {
      const r = http.get(`${BASE}/api/v1/me/kanban`, { ...auth, tags: { name: 'kanban_for_write' } });
      if (r.status === 200) {
        const data = r.json();
        const cols = data?.columns || {};
        const cards = [...(cols.IN_PROGRESS || []), ...(cols.DUE_SOON || []), ...(cols.UPCOMING || [])];
        const taskId = cards.length > 0 ? cards[0].taskId : null;
        if (taskId) {
          http.post(`${BASE}/api/v1/tasks/${taskId}/work-logs`,
            JSON.stringify({
              content: `부하 테스트 비고 ${Date.now()}`,
              workedAt: new Date().toISOString().slice(0, 10),
            }),
            { ...auth, headers: { ...auth.headers, 'Content-Type': 'application/json' }, tags: { name: 'worklog_write' } });
        }
      }
    }
  } else if (action < 0.75) {
    // 20% 결재 (실제 endpoint: /approval/documents/...)
    http.get(`${BASE}/api/v1/approval/documents/pending?limit=20`, { ...auth, tags: { name: 'approval_pending' } });
    http.get(`${BASE}/api/v1/approval/documents/sent?limit=20`,    { ...auth, tags: { name: 'approval_sent' } });
  } else if (action < 0.90) {
    // 15% 프로젝트
    http.get(`${BASE}/api/v1/projects?limit=10`, { ...auth, tags: { name: 'project_list' } });
    http.get(`${BASE}/api/v1/me/kanban`, { ...auth, tags: { name: 'my_kanban' } });
  } else {
    // 10% 대시보드/알림
    http.get(`${BASE}/api/v1/dashboard`, { ...auth, tags: { name: 'dashboard' } });
    http.get(`${BASE}/api/v1/notifications?limit=10`, { ...auth, tags: { name: 'notifications' } });
  }

  // 사용자 think time 2~7초
  sleep(Math.random() * 5 + 2);
}
