// k6 NDJSON 결과에서 endpoint별 status 분포를 집계
// Usage: node scripts/load-test/analyze-errors.mjs <k6-results.json>
import fs from 'node:fs';
import readline from 'node:readline';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node analyze-errors.mjs <k6-results.json>');
  process.exit(1);
}

const stats = new Map(); // key: `${name}|${method}|${status}` → count
const durations = new Map(); // key: name → [durations]

const rl = readline.createInterface({
  input: fs.createReadStream(file),
  crlfDelay: Infinity,
});

let totalPoints = 0;
let failedReqs = 0;
let totalReqs = 0;

for await (const line of rl) {
  if (!line) continue;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    continue;
  }
  if (obj.type !== 'Point') continue;
  if (obj.metric === 'http_reqs') {
    totalPoints++;
    const t = obj.data.tags || {};
    const name = t.name || '(no-tag)';
    const method = t.method || '?';
    const status = t.status || '0';
    const key = `${name}|${method}|${status}`;
    stats.set(key, (stats.get(key) || 0) + 1);
    totalReqs++;
    if (status === '0' || (status[0] !== '2' && status[0] !== '3')) {
      failedReqs++;
    }
  } else if (obj.metric === 'http_req_duration') {
    const t = obj.data.tags || {};
    const name = t.name || '(no-tag)';
    const expected = t.expected_response;
    if (expected !== 'true') continue;
    if (!durations.has(name)) durations.set(name, []);
    durations.get(name).push(obj.data.value);
  }
}

// Group by name (sum statuses)
const byName = new Map(); // name → { method, total, byStatus: Map<status, count> }
for (const [key, count] of stats) {
  const [name, method, status] = key.split('|');
  if (!byName.has(name)) byName.set(name, { method, total: 0, byStatus: new Map() });
  const e = byName.get(name);
  e.total += count;
  e.byStatus.set(status, (e.byStatus.get(status) || 0) + count);
}

// Sort by error rate desc
const rows = [];
for (const [name, e] of byName) {
  const success = (e.byStatus.get('200') || 0) + (e.byStatus.get('201') || 0) + (e.byStatus.get('204') || 0) + (e.byStatus.get('304') || 0);
  const errors = e.total - success;
  const errPct = (errors / e.total * 100).toFixed(1);
  const statuses = [...e.byStatus.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${s}:${c}`).join(' ');
  // p95
  const ds = durations.get(name);
  let p95 = '-';
  if (ds && ds.length > 0) {
    ds.sort((a, b) => a - b);
    p95 = `${ds[Math.floor(ds.length * 0.95)].toFixed(0)}ms`;
  }
  rows.push({ name, method: e.method, total: e.total, success, errors, errPct: parseFloat(errPct), p95, statuses });
}
rows.sort((a, b) => b.errPct - a.errPct || b.total - a.total);

console.log(`# k6 결과 분석: ${file}`);
console.log(`총 요청: ${totalReqs}, 실패: ${failedReqs} (${(failedReqs/totalReqs*100).toFixed(2)}%)`);
console.log();
console.log('| endpoint | method | total | success | errors | err% | p95 | status 분포 |');
console.log('|---|---|---:|---:|---:|---:|---:|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.method} | ${r.total} | ${r.success} | ${r.errors} | ${r.errPct}% | ${r.p95} | ${r.statuses} |`);
}
