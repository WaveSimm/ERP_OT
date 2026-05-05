#!/usr/bin/env node
/**
 * sync-orphan-approvals.js
 *
 * APPROVED 상태인 LEAVE/OT ApprovalDocument 중 attendance에 동기화 안 된 것을 찾아서 재처리.
 * 일회용 — 2026-05-04 doc.fields → doc.content 버그 fix 후 누락된 데이터 복구용.
 *
 * 사용법:
 *   docker exec -i erp-ot-approval node < scripts/sync-orphan-approvals.js
 *   또는 docker cp 후 docker exec node ...
 *
 * 사실상 두 DB 모두 접근해야 함 — approval과 attendance가 같은 PostgreSQL.
 * approval-service container에서 실행하면 양쪽 schema 모두 직접 SQL로 조회.
 */
const { PrismaClient } = require('@prisma/client');

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;
const ATTENDANCE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://attendance-service:3004';

const p = new PrismaClient();

async function main() {
  if (!INTERNAL_TOKEN) {
    console.error('INTERNAL_API_TOKEN env 필요');
    process.exit(1);
  }

  // 1. APPROVED LEAVE/OT 문서 추출
  const tplLeave = await p.approvalTemplate.findFirst({ where: { code: 'LEAVE' } });
  const tplOt = await p.approvalTemplate.findFirst({ where: { code: 'OT' } });

  const leaveDocs = await p.approvalDocument.findMany({
    where: { templateId: tplLeave?.id, status: 'APPROVED' },
    orderBy: { completedAt: 'desc' },
  });
  const otDocs = await p.approvalDocument.findMany({
    where: { templateId: tplOt?.id, status: 'APPROVED' },
    orderBy: { completedAt: 'desc' },
  });

  console.log(`📋 LEAVE APPROVED: ${leaveDocs.length}건, OT APPROVED: ${otDocs.length}건`);
  console.log('');

  // 2. attendance schema 직접 조회 — 같은 user+date 있는지 체크
  // approval-service container에서 attendance schema 접근 가능 (같은 DB)
  const existingLeaves = await p.$queryRawUnsafe(`
    SELECT "userId", "startDate", "endDate", type
    FROM attendance.leave_requests
    WHERE status = 'APPROVED'
  `);
  const existingHolidayWorks = await p.$queryRawUnsafe(`
    SELECT "userId", date
    FROM attendance.holiday_work_requests
    WHERE status = 'APPROVED'
  `);

  // 빠른 lookup용 set
  const leaveSet = new Set(
    existingLeaves.map((r) => `${r.userId}|${r.startDate.toISOString().slice(0, 10)}|${r.endDate.toISOString().slice(0, 10)}`)
  );
  const hwSet = new Set(
    existingHolidayWorks.map((r) => `${r.userId}|${r.date.toISOString().slice(0, 10)}`)
  );

  let leaveSynced = 0, leaveSkipped = 0, leaveFailed = 0;
  let otSynced = 0, otSkipped = 0, otFailed = 0;

  // 3. LEAVE 처리
  console.log('=== LEAVE ===');
  for (const doc of leaveDocs) {
    const c = doc.content || {};
    const userId = doc.requestedBy;
    const startDate = c.startDate;
    const endDate = c.endDate;
    if (!userId || !startDate || !endDate || !c.leaveType) {
      console.log(`  ⚠️  skip (incomplete): ${doc.id} - ${doc.title}`);
      leaveSkipped++;
      continue;
    }
    const key = `${userId}|${startDate}|${endDate}`;
    if (leaveSet.has(key)) {
      console.log(`  ⏭️  ${doc.requesterName || userId} / ${startDate}~${endDate} → 이미 존재 (skip)`);
      leaveSkipped++;
      continue;
    }
    try {
      const body = {
        userId,
        type: c.leaveType,
        startDate,
        endDate,
        reason: c.reason || '(재동기화)',
        ...(c.startTime ? { startTime: c.startTime } : {}),
        ...(c.endTime ? { endTime: c.endTime } : {}),
        approvalDocumentId: doc.id,
      };
      const res = await fetch(`${ATTENDANCE_URL}/internal/leave/from-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
        body: JSON.stringify(body),
      });
      const txt = await res.text();
      if (res.ok) {
        console.log(`  ✅ ${doc.requesterName || userId} / ${startDate} → synced (${c.leaveType})`);
        leaveSynced++;
        leaveSet.add(key);
      } else {
        console.log(`  ❌ ${doc.requesterName || userId} / ${startDate} → fail: ${txt.slice(0, 120)}`);
        leaveFailed++;
      }
    } catch (e) {
      console.log(`  ❌ ${doc.id} → ${e.message}`);
      leaveFailed++;
    }
  }

  // 4. OT (HolidayWork) 처리
  console.log('');
  console.log('=== OT/휴일근무 ===');
  for (const doc of otDocs) {
    const c = doc.content || {};
    const userId = doc.requestedBy;
    const datesRaw = c.workDates ?? (c.workDate ? [c.workDate] : []);
    const dates = Array.isArray(datesRaw) ? datesRaw.filter((d) => typeof d === 'string' && d.length > 0) : [];
    if (!userId || dates.length === 0 || !c.reason) {
      console.log(`  ⚠️  skip (incomplete): ${doc.id} - ${doc.title}`);
      otSkipped++;
      continue;
    }
    for (const date of dates) {
      const key = `${userId}|${date}`;
      if (hwSet.has(key)) {
        console.log(`  ⏭️  ${doc.requesterName || userId} / ${date} → 이미 존재 (skip)`);
        otSkipped++;
        continue;
      }
      try {
        const body = {
          userId,
          date,
          reason: c.reason,
          ...(c.projectId || c.project ? { projectId: c.projectId || c.project } : {}),
          ...(c.taskId || c.task ? { taskId: c.taskId || c.task } : {}),
          approvalDocumentId: doc.id,
        };
        const res = await fetch(`${ATTENDANCE_URL}/internal/holiday-work/from-approval`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Token': INTERNAL_TOKEN },
          body: JSON.stringify(body),
        });
        const txt = await res.text();
        if (res.ok) {
          console.log(`  ✅ ${doc.requesterName || userId} / ${date} → synced`);
          otSynced++;
          hwSet.add(key);
        } else {
          console.log(`  ❌ ${doc.requesterName || userId} / ${date} → fail: ${txt.slice(0, 120)}`);
          otFailed++;
        }
      } catch (e) {
        console.log(`  ❌ ${doc.id} → ${e.message}`);
        otFailed++;
      }
    }
  }

  console.log('');
  console.log('=== 결과 ===');
  console.log(`LEAVE: synced ${leaveSynced} / skipped ${leaveSkipped} / failed ${leaveFailed}`);
  console.log(`OT:    synced ${otSynced} / skipped ${otSkipped} / failed ${otFailed}`);

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
