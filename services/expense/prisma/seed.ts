// v1.6.2 (2026-05-15): ExpenseCategory 폐기. 사업(계약) 연계로 전환됨.
// seed는 더 이상 호출되지 않으나, 컴파일 호환을 위해 빈 스크립트로 유지.

async function main() {
  console.log("[expense seed] ExpenseCategory 폐기됨. 사업(계약) 직접 연계로 전환 — seed 무동작.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
