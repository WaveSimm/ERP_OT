import { PrismaClient } from "@prisma/client";
import * as path from "path";

const XLSX = require("xlsx");

const prisma = new PrismaClient();

// ─── Customer Name Mapping ──────────────────────────────────────────────────
// Excel 납품처 → DB 고객사 이름 매핑 (확정된 목록)
const CUSTOMER_NAME_MAP: Record<string, string> = {
  // === 기존 고객사 매핑 ===
  // UST21 variants
  "(주)유에스티21(UST21)": "UST21",
  "㈜유에스티21(UST21)": "UST21",
  "㈜유에스티21": "UST21",
  "유에스티21": "UST21",
  // KHOA variants
  "해양수산부 국립해양조사원(KHOA)": "KHOA",
  "해양수산부 국립해양조사원 남해사무소": "KHOA",
  "해양수산부 국립해양조사원 동해사무소": "KHOA",
  "국토해양부 국립해양조사원 서해사무소": "KHOA",
  "국토해양부 국립해양조사원 서해해양조사사무소": "KHOA",
  "해양수산부 국립해양조사원 동해해양조사사무소": "KHOA",
  "남해해양조사사": "KHOA",
  "남해해양조사사무소": "KHOA",
  "국립해양조사원": "KHOA",
  // KIOST variants
  "한국해양과학기술원": "KIOST",
  "한국해양과학기술원 KIOST": "KIOST",
  "한국해양과학기술원(KIOST)": "KIOST",
  // KOPRI
  "한국해양과학기술원 부설 극지연구소": "KOPRI",
  "극지연구소": "KOPRI",
  // KRISO variants
  "한국해양과학기술원 부설 선박해양플랜트 연구소": "KRISO",
  "한국해양과학기술원 부설 선박해양플랜트연구소": "KRISO",
  "선박해양플랜트연구소": "KRISO",
  "KRISO 고성": "KRISO",
  // KIGAM
  "한국지질자원연구원": "KIGAM",
  "한국지질자원연구원(KIGAM)": "KIGAM",
  // 오션테크 variants
  "오션테크㈜": "오션테크",
  "㈜오션테크": "오션테크",
  "(주)오션테크": "오션테크",
  "오션테크(주)": "오션테크",
  "연구팀": "오션테크",
  "오션데모": "오션테크",
  "오션재고": "오션테크",
  "OT_대형장비(문옆)": "오션테크",
  "OceanTech": "오션테크",
  // 기존 고객 직접 매핑
  "메이텍엔지니어링㈜": "메이텍엔지니어링",
  "㈜메이텍엔지니어링": "메이텍엔지니어링",
  "세광종합기술단㈜": "세광종합기술단",
  "㈜세광종합기술단": "세광종합기술단",
  "에스엠오션㈜": "에스엠오션",
  "㈜에스엠오션": "에스엠오션",
  "㈜엘티메트릭": "엘티메트릭",
  "엘티메트릭㈜": "엘티메트릭",
  "지오시스템리서치㈜": "지오시스템리서치",
  "㈜지오시스템리서치": "지오시스템리서치",
  "㈜오셔닉": "오셔닉",
  "오셔닉㈜": "오셔닉",
  "㈜오션웨이브": "오션웨이브",
  "㈜인터오션": "인터오션",
  "인터오션㈜": "인터오션",
  "엔스케이프㈜": "엔스케이프㈜",
  "㈜에이샛": "에이샛",
  "에이샛㈜": "에이샛",
  "한화시스템㈜": "한화시스템",
  "㈜한화시스템": "한화시스템",
  "MRC㈜": "MRC",
  "㈜MRC": "MRC",
  "㈜지오뷰": "지오뷰",
  "국립수산과학원": "국립수산과학원",
  "서울대학교": "서울대학교",
  "고려조선㈜": "고려조선",
  "㈜고려조선": "고려조선",
  "해안해양기술㈜": "해안해양기술",
  "㈜해안해양기술": "해안해양기술",
  "대양전기공업㈜": "대양전기공업",
  "㈜퓨어넥스": "퓨어넥스",
  "퓨어넥스㈜": "퓨어넥스",
  "MIT㈜": "MIT",
  "한국기상산업기술원": "한국기상산업기술원",
  "금강물환경센터": "금강물환경센터",
  // 기존 고객 이름 그대로 (주/㈜ 없이)
  "KOINS": "KOINS",
  "KAI": "KAI",
  "CNC OCENA": "CNC OCENA",
  "미래해양": "미래해양",
  "로고스웨어": "로고스웨어",
  "에이스해양": "에이스해양",
  "파랑해양기술": "파랑해양기술",
  "해양정보기술": "해양정보기술",
  "한국종합환경연구소": "한국종합환경연구소",
  "이엔씨기술": "이엔씨기술",
  "올포랜드": "올포랜드",
  "선영엔지니어링": "선영엔지니어링",
  "동문시스텍": "동문시스텍",
  "전남대": "전남대",
  "부경대": "부경대",
  "고려대": "고려대",
  "군산대": "군산대",
  "인하대": "인하대",
  "강원대학교": "강원대학교",
  "조사원": "조사원",
  "조사협회": "조사협회",
  "전략해양": "전략해양",
  "제주수산": "제주수산",
  "남해수산": "남해수산",
  "비엘프로세스": "비엘프로세스",
  "로마스": "로마스",
  "씨엔에스솔루션": "씨엔에스솔루션",
  "더모스트": "더모스트",
  "시화조력": "시화조력",
  "과학기지": "과학기지",
  "한일뉴즈": "한일뉴즈",
  "국토해양환경기술단": "국토해양환경기술단",
  "㈜오션": "㈜오션",
  "오션그래픽": "오션그래픽",

  // === 통합 대상 ===
  "대선조선(주)": "대선조선",
  "대선조선㈜": "대선조선",
  "대선조선㈜-코릴": "코릴",
  "삼성물산(주)": "삼성물산",
  "삼성물산㈜": "삼성물산",
  "주식회사 삼성물산": "삼성물산",
  "LIG넥스원(주)": "LIG넥스원",
  "LIG넥스원㈜": "LIG넥스원",
  "주식회사 LIG넥스원": "LIG넥스원",
  "엘아이지(LIG)넥스원": "LIG넥스원",
  "㈜엘아이지넥스원": "LIG넥스원",
  "대영엔지니어링(주)": "대영엔지니어링",
  "대영엔지니어링㈜": "대영엔지니어링",
  "㈜대영엔지니어링": "대영엔지니어링",
  "에이엘(주)": "에이엘",
  "에이엘㈜": "에이엘",
  "㈜에이엘": "에이엘",
  "KIMST(주)": "KIMST",
  "KIMST㈜": "KIMST",
  "(주)KIMST": "KIMST",
  "해양수산과학기술진흥원(KIMST)": "KIMST",
  "해양수산과학기술진흥원": "KIMST",
  "부산대학교산학협력단": "부산대학교산학협력단",
  "부산대학교": "부산대학교",

  // === 신규 고객 (확정) ===
  "한국해양": "한국해양",
  "한국": "한국",
  "주식회사 엠": "엠",
  "(주)엠": "엠",
  "㈜엠": "엠",
  "주식회사 엠디": "엠디",
  "(주)엠디": "엠디",
  "㈜엠디": "엠디",
  "월성원자력본부": "월성원자력본부",
  "한수원(주)월성원자력본부": "월성원자력본부",
  "한울원자력본부": "한울원자력본부",
  "고리원전": "고리원전",
  "새울원전": "새울원전",

  // === 에이엘 variants ===
  "주식회사 어쿠스틱랩(AL)": "에이엘",
  "어쿠스틱랩(AL)": "에이엘",
  "어쿠스틱랩": "에이엘",
  "(주)에이엘": "에이엘",
  "㈜에이엘": "에이엘",

  // === KAI ===
  "한국항공우주산업주식회사": "KAI",
  "한국항공우주산업(주)": "KAI",
  "한국항공우주산업": "KAI",

  // === LIG넥스원 (엘아이지) ===
  "엘아이지(LIG)넥스원(주)": "LIG넥스원",
  "엘아이지(LIG)넥스원㈜": "LIG넥스원",
  "엘아이지(LIG)넥스원": "LIG넥스원",

  // === 기존 고객 매핑 (추가) ===
  "(주)해양정보기술 MIT": "MIT",
  "해양정보기술 MIT": "MIT",
  "해양정보기술(주) MIT": "MIT",
  "국립수산과학원 남해수산연구소": "국립수산과학원",
  "한국해양조사협회": "조사협회",
  "인하대학교": "인하대",
  "고려대학교 산학협력단": "고려대",
  "군산대학교 산학협력단": "군산대",
  "강원대학교 삼척산학협력단": "강원대학교",
  "전남대학교산학협력단 여수산학협력본부": "전남대",
  "서울대학교 산학협력단": "서울대학교",
  "한국수자원공사": "한국수자원공사",
  "한국에너지기술연구원": "한국에너지기술연구원",
  "한국과학기술원": "한국과학기술원",
  "한국수자원Southern Tech Solutions SpA (칠레)공사": "한국수자원공사",
  "(주)한국종합환경연구소": "한국종합환경연구소",
  "(주)미래해양": "미래해양",
  "(주)에이샛": "에이샛",
  "(주) 세광종합기술단": "세광종합기술단",
  "(주) 씨텍": "씨텍",
  "(주) 오션그래픽": "오션그래픽",
  "㈜오션그래픽": "오션그래픽",
  "(주) 전략해양": "전략해양",
  "(주)지오시스템리서치": "지오시스템리서치",
  "(주)해안해양기술": "해안해양기술",
  "대양전기공업(주)": "대양전기공업",
  "대양전기공업㈜": "대양전기공업",
  "퓨어넥스 주식회사": "퓨어넥스",
  "주식회사 오셔닉": "오셔닉",
  "주식회사 오션웨이브": "오션웨이브",
  "주식회사 지오뷰": "지오뷰",
  "주식회사지오뷰": "지오뷰",
  "주식회사 파랑해양기술": "파랑해양기술",
  "㈜올포랜드": "올포랜드",
  "한화시스템": "한화시스템",
  "인터오션": "인터오션",

  // === 신규 고객 (normalizeCustomerName fallback에 의해 (주)/㈜/주식회사 제거) ===
  "(주)대현환경": "대현환경",
  "경원산업주식회사": "경원산업",
  "(주)바담엔지니어링": "바담엔지니어링",
  "우리해양 주식회사": "우리해양",
  "(주) 지오테크시스템": "지오테크시스템",
  "디에스티컴퍼니": "디에스티컴퍼니",
  "(주)코니아이앤씨": "코니아이앤씨",
  "전남해상풍력": "전남해상풍력",
  "스타컴퍼니": "스타컴퍼니",
  "주식회사 씨테크코퍼레이션": "씨테크코퍼레이션",
  "엘티삼보 주식회사": "엘티삼보",
  "그린블루": "그린블루",
  "서우에스앤티": "서우에스앤티",
  "대우이앤씨": "대우이앤씨",
  "소나테크주식회사": "소나테크",
  "에스지에스": "에스지에스",
  "주식회사 케이엠티": "케이엠티",
  "(주)일우인터내셔날": "일우인터내셔날",
  "(주)비에네스소프트": "비에네스소프트",
  "주식회사 오션사이언스": "오션사이언스",
  "주식회사 포어시스": "포어시스",
  "(주)코리아철물": "코리아철물",
  "삼성중공업(주) 거제조선소": "삼성중공업 거제조선소",
  "주식회사 패리티": "패리티",
  "주식회사 지디엘시스템": "지디엘시스템",
  "이엔에스(E&S)": "이엔에스",
  "(주)에이치와이산업": "에이치와이산업",
  "(주)이에스솔루션즈": "이에스솔루션즈",
  "주식회사 볼시스": "볼시스",
  "주식회사 엔비전": "엔비전",
  "기상청": "기상청",
  "위덕대학교 산학협력단": "위덕대학교",
  "시원컴퍼니": "시원컴퍼니",
  "어비스테크": "어비스테크",
  "한국해양대학교산학협력단": "한국해양대학교",
  "주식회사 삼원중공업 군산공장": "삼원중공업 군산공장",
  "아시아조선 주식회사": "아시아조선",
  "주식회사 지오스토리": "지오스토리",
  "(주)모션다이나믹스": "모션다이나믹스",
  "유한회사 나우코퍼레이션": "나우코퍼레이션",
  "Southern Tech Solutions SpA (칠레)": "Southern Tech Solutions",
  "(주)씨텍": "씨텍",
  "아르게스마린": "아르게스마린",
  "(주)아르게스마린": "아르게스마린",
};

// 분류 → InventoryCategory
function mapCategory(raw: string): string {
  if (!raw) return "PRODUCT";
  const s = raw.replace(/\r?\n/g, "").trim();
  if (s.startsWith("미착품")) return "IN_TRANSIT";
  if (s.startsWith("상품")) return "PRODUCT";
  if (s.startsWith("원재료")) return "RAW_MATERIAL";
  if (s.startsWith("전기상품")) return "PREV_PRODUCT";
  if (s.startsWith("전기원재료") || s.startsWith("전기")) return "PREV_RAW_MATERIAL";
  return "PRODUCT";
}

// 구분 → InventoryTransactionType
function mapTransactionType(raw: string): string {
  if (!raw) return "PURCHASE";
  const s = raw.trim();
  if (s === "구매") return "PURCHASE";
  if (s === "창고") return "TRANSFER";
  if (s === "판매") return "RELEASE";
  return "PURCHASE";
}

// 납품처 이름 정규화 (주/㈜/주식회사 제거)
function normalizeCustomerName(raw: string): string {
  // 먼저 매핑 테이블 확인
  if (CUSTOMER_NAME_MAP[raw]) return CUSTOMER_NAME_MAP[raw];

  // (주), ㈜, 주식회사 제거
  let name = raw
    .replace(/^\(주\)\s*/g, "")
    .replace(/\s*\(주\)$/g, "")
    .replace(/^㈜\s*/g, "")
    .replace(/\s*㈜$/g, "")
    .replace(/^주식회사\s*/g, "")
    .replace(/\s*주식회사$/g, "")
    .trim();

  // 매핑 테이블에서 정규화된 이름도 확인
  if (CUSTOMER_NAME_MAP[name]) return CUSTOMER_NAME_MAP[name];

  return name;
}

// 일자-No. 파싱: "2024/09/09 -1" → { date: Date, sequenceNo: "1" }
function parseDateNo(raw: string): { date: Date; sequenceNo: string } | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4}\/\d{2}\/\d{2})\s*-(\d+)$/);
  if (!match) return null;
  return {
    date: new Date(match[1].replace(/\//g, "-")),
    sequenceNo: match[2],
  };
}

// Decimal 파싱
function parseDecimal(val: any): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

async function main() {
  console.log("=== 재고 엑셀 마이그레이션 시작 ===\n");

  // 1. 엑셀 읽기
  const xlsxPath = path.resolve(__dirname, "../../../References/inventory/합본_전체본.xlsx");
  const wb = XLSX.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log(`엑셀 로드: ${rows.length - 1} 데이터 행 (헤더 제외)`);

  // 2. 데이터 행 필터링 (합계 행, 빈 행 제거)
  const dataRows = rows.slice(1).filter((row) => {
    const category = String(row[0] || "");
    const type = String(row[5] || "");
    const inventoryNo = String(row[6] || "");
    // 합계 행 제거, 구분(구매/창고/판매)과 재고번호가 있어야 함
    if (category.includes("합계")) return false;
    if (!type || !inventoryNo) return false;
    return true;
  });
  console.log(`유효 데이터 행: ${dataRows.length}`);

  // 3. 기존 고객사 로드
  const existingCustomers = await prisma.customer.findMany();
  const customerByName: Record<string, string> = {};
  for (const c of existingCustomers) {
    customerByName[c.name] = c.id;
  }
  console.log(`기존 고객사: ${existingCustomers.length}개`);

  // 4. 납품처에서 신규 고객사 식별 및 생성
  const allDeliveryNames = new Set<string>();
  for (const row of dataRows) {
    const deliveryTo = String(row[14] || "").trim();
    if (deliveryTo) allDeliveryNames.add(deliveryTo);
  }

  const newCustomers: string[] = [];
  for (const rawName of allDeliveryNames) {
    const mapped = normalizeCustomerName(rawName);
    if (!mapped) continue;
    if (!customerByName[mapped]) {
      newCustomers.push(mapped);
    }
  }
  const uniqueNew = [...new Set(newCustomers)];
  console.log(`신규 고객사 생성 필요: ${uniqueNew.length}개`);

  for (const name of uniqueNew) {
    const created = await prisma.customer.create({
      data: { name },
    });
    customerByName[name] = created.id;
    console.log(`  + 신규 고객사: ${name}`);
  }

  // 5. 재고번호별 그룹핑
  const itemGroups: Record<string, any[][]> = {};
  for (const row of dataRows) {
    const inventoryNo = String(row[6]).trim();
    if (!itemGroups[inventoryNo]) itemGroups[inventoryNo] = [];
    itemGroups[inventoryNo].push(row);
  }
  console.log(`\n재고 품목 수: ${Object.keys(itemGroups).length}`);

  // 6. 기존 재고 데이터 삭제 (마이그레이션 재실행 대비)
  const existingCount = await prisma.inventoryItem.count();
  if (existingCount > 0) {
    console.log(`기존 재고 데이터 ${existingCount}건 삭제 중...`);
    await prisma.inventoryTransaction.deleteMany({});
    await prisma.inventoryItem.deleteMany({});
  }

  // 7. 재고 아이템 + 트랜잭션 생성
  let itemCount = 0;
  let txCount = 0;
  let errorCount = 0;

  for (const [inventoryNo, group] of Object.entries(itemGroups)) {
    try {
      // 첫 번째 행(구매)에서 아이템 기본 정보 추출
      const firstRow = group[0];
      const lastRow = group[group.length - 1];

      const category = mapCategory(String(firstRow[0] || ""));
      const itemName = String(firstRow[8] || "").trim() || null;
      const serialNumber = String(firstRow[15] || "").trim() || null;
      const manufacturer = String(firstRow[11] || "").trim() || null;
      const quantity = Number(firstRow[9]) || 1;

      // 금액: 첫 구매 행에서 가져옴
      const unitPrice = parseDecimal(firstRow[16]);
      const supplyAmount = parseDecimal(firstRow[17]);
      const totalAmount = parseDecimal(firstRow[18]);

      // 현재 위치: 마지막 행의 이동창고 또는 최초창고
      const currentLocation =
        String(lastRow[13] || "").trim() ||
        String(lastRow[12] || "").trim() ||
        null;

      // 현재 상태: 마지막 트랜잭션이 판매면 RELEASED
      const lastType = mapTransactionType(String(lastRow[5] || ""));
      const currentStatus = lastType === "RELEASE" ? "RELEASED" : "IN_STOCK";

      // 프로젝트명, 담당자: 첫 행에서
      const projectName = String(firstRow[19] || "").replace(/\r?\n/g, " ").trim() || null;
      const assigneeName = String(firstRow[20] || "").trim() || null;

      // 아이템 생성
      const item = await prisma.inventoryItem.create({
        data: {
          inventoryNo,
          itemName,
          manufacturer,
          category: category as any,
          serialNumber,
          quantity,
          currentLocation,
          currentStatus: currentStatus as any,
          unitPrice: unitPrice !== null ? unitPrice : undefined,
          supplyAmount: supplyAmount !== null ? supplyAmount : undefined,
          totalAmount: totalAmount !== null ? totalAmount : undefined,
          projectName,
          assigneeName,
          createdBy: "migration",
          notes: String(firstRow[22] || "").replace(/\r?\n/g, " ").trim() || null,
        },
      });
      itemCount++;

      // 트랜잭션 생성
      for (const row of group) {
        const type = mapTransactionType(String(row[5] || ""));
        const dateNo = parseDateNo(String(row[7] || ""));
        if (!dateNo) continue;

        const deliveryToRaw = String(row[14] || "").trim();
        const deliveryTo = deliveryToRaw ? normalizeCustomerName(deliveryToRaw) : null;

        const fromLocation = String(row[12] || "").trim() || null;
        const toLocation = String(row[13] || "").trim() || null;
        const supplier = String(row[10] || "").trim() || null;
        const txProjectName = String(row[19] || "").replace(/\r?\n/g, " ").trim() || null;
        const txAssigneeName = String(row[20] || "").trim() || null;
        const costNumber = String(row[21] || "").trim() || null;
        const txNotes = String(row[22] || "").replace(/\r?\n/g, " ").trim() || null;
        const txQuantity = Number(row[9]) || 1;

        await prisma.inventoryTransaction.create({
          data: {
            inventoryItemId: item.id,
            type: type as any,
            date: dateNo.date,
            sequenceNo: dateNo.sequenceNo,
            quantity: txQuantity,
            fromLocation,
            toLocation,
            deliveryTo,
            supplier,
            projectName: txProjectName,
            assigneeName: txAssigneeName,
            costNumber,
            notes: txNotes,
            createdBy: "migration",
          },
        });
        txCount++;
      }
    } catch (err: any) {
      errorCount++;
      console.error(`  ❌ ${inventoryNo}: ${err.message}`);
    }
  }

  console.log(`\n=== 마이그레이션 완료 ===`);
  console.log(`재고 아이템: ${itemCount}건 생성`);
  console.log(`입출고 이력: ${txCount}건 생성`);
  if (errorCount > 0) console.log(`오류: ${errorCount}건`);

  // 8. 통계
  const stats = await prisma.$queryRaw`
    SELECT category, COUNT(*) as cnt
    FROM equipment.inventory_items
    GROUP BY category ORDER BY category
  ` as any[];
  console.log("\n카테고리별 현황:");
  for (const s of stats) {
    console.log(`  ${s.category}: ${s.cnt}건`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
