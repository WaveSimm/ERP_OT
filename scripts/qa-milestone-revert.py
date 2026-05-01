#!/usr/bin/env python3
"""Zero Script QA — 마일스톤-시점태스크-회귀."""
import sys, io, json
import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

AUTH = "http://localhost:3001"
PRJ = "http://localhost:3003"
P = "cmolmw4we00tszjt2jnu8099r"  # KHOA

# Login
tok = requests.post(f"{AUTH}/api/v1/auth/login",
    json={"email": "dev@oceant.com", "password": "dev1234"}).json()["accessToken"]
H = {"Authorization": f"Bearer {tok}"}

results = []

def ok(name, cond, detail=""):
    mark = "✓" if cond else "✗"
    results.append((cond, name))
    print(f"  {mark} {name} {detail}")

# QA-1: isMilestone=true task 생성
print("=== QA-1: isMilestone=true task 생성 ===")
r = requests.post(f"{PRJ}/api/v1/projects/{P}/tasks", headers=H,
    json={"name": "QA-1 시점 task", "isMilestone": True, "sortOrder": 999})
t = r.json()
ok("task created with isMilestone=true", r.ok and t.get("isMilestone") is True, f"id={t.get('id','?')[:30]}")
TID = t["id"]

# QA-1b: 단일 segment 생성
print("=== QA-1b: 시점 task에 segment 1개 생성 ===")
r = requests.post(f"{PRJ}/api/v1/projects/{P}/tasks/{TID}/segments", headers=H,
    json={"name": "시점", "startDate": "2026-06-01", "endDate": "2026-06-01"})
s = r.json()
ok("segment created (start=end)", r.ok and s.get("startDate","")[:10] == "2026-06-01" == s.get("endDate","")[:10],
   f"start={s.get('startDate','?')[:10]} end={s.get('endDate','?')[:10]}")
SID = s["id"]

# QA-2: 두 번째 segment 추가 거부
print("=== QA-2: 시점 task에 두 번째 segment 추가 거부 ===")
r = requests.post(f"{PRJ}/api/v1/projects/{P}/tasks/{TID}/segments", headers=H,
    json={"name": "두번째", "startDate": "2026-06-05", "endDate": "2026-06-05"})
err = r.json() if r.text else {}
ok("second segment rejected", not r.ok and err.get("code","").startswith("MILESTONE_SINGLE"),
   f"http={r.status_code} code={err.get('code','-')}")

# QA-4: startDate만 변경 → endDate 자동 동기화
print("=== QA-4: 시점 segment startDate만 변경 → endDate 강제 동기화 ===")
r = requests.patch(f"{PRJ}/api/v1/projects/{P}/tasks/{TID}/segments/{SID}", headers=H,
    json={"startDate": "2026-07-15"})
s = r.json()
ok("endDate forced to startDate", r.ok and s.get("startDate","")[:10] == "2026-07-15" == s.get("endDate","")[:10],
   f"start={s.get('startDate','?')[:10]} end={s.get('endDate','?')[:10]}")

# QA-2b: 부모 task isMilestone=true 인 경우 자식 추가 거부
print("=== QA-2b: 시점 task를 parent로 자식 task 추가 거부 ===")
r = requests.post(f"{PRJ}/api/v1/projects/{P}/tasks", headers=H,
    json={"name": "child of milestone", "parentId": TID})
err = r.json() if r.text else {}
ok("child of milestone rejected", not r.ok and "MILESTONE" in err.get("code",""),
   f"http={r.status_code} code={err.get('code','-')}")

# QA-5: Dependency Task↔Task (polymorphic 제거 확인)
print("=== QA-5: Dependency Task↔Task ===")
# 가장 빠른 task를 predecessor로
gantt = requests.get(f"{PRJ}/api/v1/projects/{P}/gantt", headers=H).json()
candidates = [t for t in gantt["tasks"] if t["id"] != TID and not t.get("isMilestone")]
PRED = candidates[0]["id"] if candidates else None
if not PRED:
    ok("dependency create", False, "no predecessor candidate")
else:
    r = requests.post(f"{PRJ}/api/v1/projects/{P}/dependencies", headers=H,
        json={"predecessorTaskId": PRED, "successorTaskId": TID,
              "dependencyType": "FS", "lag": 0})
    d = r.json()
    ok("dependency created (Task↔Task)", r.ok and d.get("predecessorTaskId") == PRED,
       f"id={d.get('id','?')[:25]} type={d.get('dependencyType')}")

# Cleanup
print("=== cleanup ===")
r = requests.delete(f"{PRJ}/api/v1/projects/{P}/tasks/{TID}", headers=H)
print(f"  delete task: HTTP {r.status_code}")

# Summary
print()
passed = sum(1 for ok, _ in results if ok)
total = len(results)
print(f"==== Result: {passed}/{total} passed ====")
sys.exit(0 if passed == total else 1)
