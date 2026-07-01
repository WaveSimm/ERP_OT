// MS Planner 플랜 → 프로젝트 시스템 실제 적재 (project 컨테이너 Prisma).
//   입력: tmp/planner_plan.json (planner-import.js 드라이런 산출물)
//   env : OWNER_ID(소유자 userId), FOLDER_ID(기술팀 폴더), PROJECT_NAME
//   롤백: DELETE FROM project.projects WHERE id='<projectId>' (cascade 전체 삭제)
//   멱등: 동일 이름 프로젝트 있으면 중단.
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");

async function main() {
  const plan = JSON.parse(fs.readFileSync(process.argv[2] || "/tmp/planner_plan.json", "utf8"));
  const ownerId = process.env.OWNER_ID;
  const folderId = process.env.FOLDER_ID;
  const projectName = process.env.PROJECT_NAME || "ERP 개발";
  if (!ownerId || !folderId) throw new Error("OWNER_ID, FOLDER_ID env 필요");

  const p = new PrismaClient();
  const exists = await p.project.findFirst({ where: { name: projectName } });
  if (exists) { console.log(JSON.stringify({ aborted: "동일 이름 프로젝트 이미 존재", projectId: exists.id })); await p.$disconnect(); return; }

  const tasks = plan.tasks;
  const parentSet = new Set(tasks.map((t) => t.parentOutline).filter(Boolean));
  const allDates = tasks.filter((t) => t.start && t.end).flatMap((t) => [t.start, t.end]).sort();
  const projStart = allDates.length ? new Date(allDates[0]) : null;
  const projEnd = allDates.length ? new Date(allDates[allDates.length - 1]) : null;
  const metaPct = (() => { const m = String(plan.meta["% 완료"] || "").match(/(\d+)/); return m ? Number(m[1]) : null; })();
  const statusOf = (pct) => (pct >= 100 ? "DONE" : pct > 0 ? "IN_PROGRESS" : "TODO");

  // 1) 프로젝트
  const project = await p.project.create({ data: {
    name: projectName,
    description: `MS Planner 이관 (${plan.meta["프로젝트 이름"]})`,
    status: "IN_PROGRESS",
    ownerId, createdBy: "planner-import",
    overallProgress: metaPct, effectiveStartDate: projStart, effectiveEndDate: projEnd,
  } });

  // 2) 기술팀 폴더 연결
  const itemCount = await p.projectFolderItem.count({ where: { folderId } });
  await p.projectFolderItem.create({ data: { folderId, projectId: project.id, sortOrder: itemCount } });

  // 3) 태스크 (부모 먼저)
  const sorted = [...tasks].sort((a, b) => {
    const da = (a.outline.match(/\./g) || []).length, db = (b.outline.match(/\./g) || []).length;
    if (da !== db) return da - db;
    return a.outline.localeCompare(b.outline, undefined, { numeric: true });
  });
  const outlineToId = new Map();
  for (const t of sorted) {
    const created = await p.task.create({ data: {
      projectId: project.id,
      parentId: t.parentOutline ? outlineToId.get(t.parentOutline) : null,
      name: t.name,
      status: statusOf(t.progress),
      sortOrder: t.sortOrder || 0,
      overallProgress: t.progress || 0,
      isMilestone: !!t.isMilestone,
      createdBy: "planner-import",
      effectiveStartDate: t.start ? new Date(t.start) : null,
      effectiveEndDate: t.end ? new Date(t.end) : null,
    } });
    outlineToId.set(t.outline, created.id);
  }

  // 4) 세그먼트 + 배정 (날짜 있는 리프만)
  let segCount = 0, asgCount = 0;
  for (const t of sorted) {
    if (parentSet.has(t.outline) || !t.hasSegment) continue;
    const taskId = outlineToId.get(t.outline);
    const seg = await p.taskSegment.create({ data: {
      taskId, name: t.name.slice(0, 200), sortOrder: 0,
      startDate: new Date(t.start), endDate: new Date(t.end),
      progressPercent: t.progress || 0,
    } });
    segCount++;
    const n = t.assignees.length;
    for (const u of t.assignees) {
      await p.segmentAssignment.create({ data: {
        segmentId: seg.id, resourceId: u.id, personUserId: u.id,
        allocationMode: "PERCENT", allocationPercent: 100,
        contributionWeight: n ? Math.round((100 / n) * 100) / 100 : 0,
        progressPercent: t.progress || 0,
      } });
      asgCount++;
    }
  }

  // 5) 의존성 (FS)
  let depCount = 0;
  for (const d of plan.deps) {
    const predId = outlineToId.get(d.predOutline), succId = outlineToId.get(d.succOutline);
    if (!predId || !succId || predId === succId) continue;
    await p.dependency.create({ data: {
      predecessorTaskId: predId, successorTaskId: succId,
      dependencyType: d.type || "FS", lag: 0, createdBy: "planner-import",
    } });
    depCount++;
  }

  await p.$disconnect();
  console.log(JSON.stringify({
    projectId: project.id, name: projectName,
    tasks: tasks.length, segments: segCount, assignments: asgCount, dependencies: depCount,
    rollback: `DELETE FROM project.projects WHERE id='${project.id}';`,
  }, null, 2));
}
main().catch((e) => { console.error("적재 실패:", e.message); process.exit(1); });
