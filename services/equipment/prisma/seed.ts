import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ─── 계약 데이터 (2026년 계약파일리스트) ──────────────────────────────
  const contracts = [
    { n:1, client:"엘티메트릭", contact:"이혁", mfr:"Caris", name:"Caris Hips and Sips", cat:"물품", type:"내자", date:"2026-01-06", deadline:"", mgr:"이학용" },
    { n:2, client:"KIGAM", contact:"이한희", mfr:"Sercl", name:"고해상 탄성파 음원 생성기 부품", cat:"물품", type:"외자", date:"2026-12-30", deadline:"2026-06-07", mgr:"오원진" },
    { n:3, client:"에이샛", contact:"송성의", mfr:"", name:"STREAM+ 통신요금", cat:"물품", type:"내자", date:"2026-01-06", deadline:"", mgr:"강성화" },
    { n:4, client:"고려조선", contact:"", mfr:"오션테크", name:"프레임, 연동장치 및 시스템 통합", cat:"물품", type:"내자", date:"2026-01-06", deadline:"2026-07-31", mgr:"오원진" },
    { n:5, client:"고려조선", contact:"", mfr:"오션테크", name:"자료 통합 및 선박 모니터링 시스템 개발", cat:"물품", type:"내자", date:"2026-01-06", deadline:"2026-07-31", mgr:"오원진" },
    { n:6, client:"KHOA", contact:"", mfr:"오션테크", name:"2026년 해수유동관측소 유지관리", cat:"용역", type:"내자", date:"2026-01-07", deadline:"2026-12-10", mgr:"사업팀" },
    { n:7, client:"지오뷰", contact:"김민중", mfr:"Oceaneering", name:"Atlas H10 보정신호 서비스", cat:"물품", type:"내자", date:"2026-01-09", deadline:"", mgr:"현지윤" },
    { n:8, client:"지오뷰", contact:"김인재", mfr:"Chesapeake", name:"SonarWiz EMA 4식", cat:"물품", type:"내자", date:"2026-01-09", deadline:"", mgr:"현지윤" },
    { n:9, client:"엔스케이프㈜", contact:"소영덕", mfr:"", name:"영덕 해수유동관측시스템 복구", cat:"물품", type:"내자", date:"2026-01-08", deadline:"", mgr:"김승환" },
    { n:10, client:"KOPRI", contact:"조자연", mfr:"", name:"차세대 쇄빙연구선 피스톤 시추기 구매", cat:"물품", type:"내자", date:"2026-01-06", deadline:"2026-12-31", mgr:"강성화" },
    { n:11, client:"KOPRI", contact:"조자연", mfr:"", name:"차세대 쇄빙연구선 다중채널 탄성파 탐사시스템 구매", cat:"물품", type:"내자", date:"2026-01-06", deadline:"2026-12-31", mgr:"강성화" },
    { n:12, client:"KOPRI", contact:"조자연", mfr:"ZLS", name:"차세대 쇄빙연구선 해상중력계 구매", cat:"물품", type:"내자", date:"2026-01-06", deadline:"2026-12-31", mgr:"강성화" },
    { n:13, client:"KIOST", contact:"강한구", mfr:"Oceaneering", name:"이사부호 DGPS Cnav", cat:"물품", type:"내자", date:"2026-01-13", deadline:"2026-06-30", mgr:"김재엽" },
    { n:14, client:"KHOA", contact:"고준철", mfr:"오션테크", name:"군산항 보험", cat:"물품", type:"내자", date:"2026-01-05", deadline:"", mgr:"사업팀" },
    { n:15, client:"한국기상산업기술원", contact:"서성희", mfr:"오션테크", name:"해양기상관측장비 유지보수관리 용역", cat:"용역", type:"내자", date:"2026-01-12", deadline:"2026-12-31", mgr:"하선종" },
    { n:16, client:"KIOST", contact:"조진형", mfr:"Geometrics", name:"Armoured cable 500m", cat:"물품", type:"내자", date:"2026-01-13", deadline:"2026-03-20", mgr:"오원진" },
    { n:17, client:"KAI", contact:"전영탁", mfr:"오션테크", name:"AUV 해상시험 지원", cat:"용역", type:"내자", date:"2026-01-15", deadline:"", mgr:"강성화" },
    { n:18, client:"MRC", contact:"임성진", mfr:"오션테크", name:"GNSS 시스템 교체 기술지원", cat:"용역", type:"내자", date:"2026-01-15", deadline:"", mgr:"현지윤" },
    { n:19, client:"오션웨이브", contact:"", mfr:"오션테크", name:"Data cable 50m", cat:"물품", type:"내자", date:"2026-01-19", deadline:"", mgr:"현지윤" },
    { n:20, client:"세광종합기술단", contact:"김지희", mfr:"오션테크", name:"건다이버", cat:"물품", type:"내자", date:"2026-01-19", deadline:"", mgr:"오원진" },
    { n:21, client:"KHOA", contact:"이다래", mfr:"AADI", name:"압력식 조위계 검교정", cat:"물품", type:"내자", date:"2026-01-19", deadline:"2026-03-25", mgr:"현지윤" },
    { n:22, client:"금강물환경센터", contact:"", mfr:"오션테크", name:"UPR 1식", cat:"물품", type:"내자", date:"", deadline:"", mgr:"이학용" },
    { n:23, client:"서울대학교", contact:"한종훈", mfr:"Benthos", name:"865 Battery 2식, R12K Battery 2식", cat:"물품", type:"내자", date:"2026-01-20", deadline:"", mgr:"황유진" },
    { n:24, client:"KOPRI", contact:"권조아", mfr:"Nautilus", name:"Glass buoy 7식", cat:"물품", type:"내자", date:"2026-01-21", deadline:"2026-03-20", mgr:"현지윤" },
    { n:25, client:"KOINS", contact:"심재진", mfr:"AADI", name:"DCPS용 10m Cable", cat:"물품", type:"내자", date:"2026-01-22", deadline:"", mgr:"하선종" },
    { n:26, client:"해안해양기술", contact:"김종덕", mfr:"인현산업", name:"수중배터리 하우징 제작 및 수중 벌크헤드", cat:"물품", type:"내자", date:"2026-01-22", deadline:"", mgr:"하선종" },
    { n:27, client:"KHOA", contact:"허남욱", mfr:"AADI", name:"조류관측 사업을 위한 도플러 유속계 구매", cat:"물품", type:"내자", date:"2026-01-23", deadline:"2026-04-30", mgr:"하선종" },
    { n:28, client:"KHOA", contact:"심현지", mfr:"오션테크", name:"인천조위관측소 GNSS 케이블 교체", cat:"용역", type:"내자", date:"2026-01-23", deadline:"2026-02-06", mgr:"하선종" },
    { n:29, client:"KAI", contact:"안정민", mfr:"오션테크", name:"계류기뢰용 씽커 제작, 설치지원", cat:"용역", type:"내자", date:"2026-01-09", deadline:"", mgr:"강성화" },
    { n:30, client:"UST21", contact:"신수철", mfr:"Reson", name:"T50 Dual Head 수리", cat:"물품", type:"내자", date:"2026-01-26", deadline:"", mgr:"현지윤" },
    { n:31, client:"KHOA", contact:"김하늘", mfr:"오션테크", name:"2026년 해양관측부이 특정규격 물품", cat:"물품", type:"내자", date:"2026-01-28", deadline:"2026-04-28", mgr:"사업팀" },
    { n:32, client:"KHOA", contact:"최효근", mfr:"Marine Magnetics", name:"SeaSPY2 점검 및 수리", cat:"물품", type:"내자", date:"2026-01-28", deadline:"2026-03-31", mgr:"김재엽" },
    { n:33, client:"지오시스템리서치", contact:"박문상", mfr:"Reson", name:"T50-P 수리", cat:"물품", type:"내자", date:"2026-01-29", deadline:"", mgr:"현지윤" },
    { n:34, client:"KIOST", contact:"김한수", mfr:"Reson", name:"Hydrophone 외 3건", cat:"물품", type:"내자", date:"2026-01-28", deadline:"2026-04-30", mgr:"오원진" },
    { n:35, client:"KHOA", contact:"", mfr:"오션테크", name:"옹진소청초 해양과학기지 전력복구를 위한 긴급점검", cat:"용역", type:"내자", date:"2026-01-23", deadline:"2026-01-26", mgr:"사업팀" },
    { n:36, client:"KHOA", contact:"", mfr:"오션테크", name:"옹진소청초 해양과학기지 긴급점검", cat:"용역", type:"내자", date:"2026-01-05", deadline:"2026-01-06", mgr:"사업팀" },
    { n:37, client:"오셔닉", contact:"박지민", mfr:"오션테크", name:"UPR 1식", cat:"물품", type:"내자", date:"2026-01-29", deadline:"", mgr:"황유진" },
    { n:38, client:"지오시스템리서치", contact:"박찬호", mfr:"SIG", name:"M2 수리", cat:"물품", type:"내자", date:"2026-01-30", deadline:"", mgr:"오원진" },
    { n:39, client:"인터오션", contact:"배재민", mfr:"Sea Ocean", name:"Reference sensor", cat:"물품", type:"내자", date:"2026-01-29", deadline:"", mgr:"현지윤" },
    { n:40, client:"MIT", contact:"박태홍", mfr:"SIG", name:"Power Supply Unit 수리", cat:"물품", type:"내자", date:"2026-01-30", deadline:"", mgr:"오원진" },
    { n:41, client:"퓨어넥스", contact:"김우람", mfr:"Deepsea", name:"LSL-2000 2식", cat:"물품", type:"내자", date:"2026-01-30", deadline:"2026-06-19", mgr:"황유진" },
    { n:42, client:"지오뷰", contact:"김민중", mfr:"Oceaneering", name:"Atlas H10 보정신호 서비스 1개월", cat:"물품", type:"내자", date:"2026-02-02", deadline:"", mgr:"현지윤" },
    { n:43, client:"KIOST", contact:"", mfr:"오션테크", name:"XRF 코어 스캐너 유지 및 보수 용역", cat:"물품", type:"내자", date:"2026-01-29", deadline:"2026-12-31", mgr:"하선종" },
    { n:44, client:"국립수산과학원", contact:"김상일", mfr:"오션테크", name:"박스코어 수리", cat:"물품", type:"내자", date:"2026-01-23", deadline:"2026-02-04", mgr:"하선종" },
    { n:45, client:"에이샛", contact:"송성의", mfr:"오션테크", name:"STREAM+ 통신요금", cat:"물품", type:"내자", date:"2026-02-05", deadline:"", mgr:"강성화" },
    { n:46, client:"지오뷰", contact:"김민중", mfr:"Oceaneering", name:"Atlas H10 보정신호 서비스", cat:"물품", type:"내자", date:"2026-02-06", deadline:"", mgr:"현지윤" },
    { n:47, client:"KHOA", contact:"", mfr:"오션테크", name:"2026년 해양과학기지 유지관리", cat:"용역", type:"내자", date:"2026-02-09", deadline:"2026-12-31", mgr:"사업팀" },
    { n:48, client:"KIOST", contact:"금병철", mfr:"Microsec", name:"Sting 수리", cat:"물품", type:"내자", date:"2026-02-06", deadline:"", mgr:"오원진" },
    { n:49, client:"KHOA", contact:"", mfr:"Reson", name:"다중빔 음향측심기 구매 및 설치", cat:"물품", type:"내자", date:"2026-02-10", deadline:"2026-08-31", mgr:"" },
    { n:50, client:"해안해양기술", contact:"강미리", mfr:"오션테크", name:"UPR 1식", cat:"물품", type:"내자", date:"2026-02-10", deadline:"", mgr:"이학용" },
    { n:51, client:"KIOST", contact:"류경호", mfr:"오션테크", name:"UPR 5식", cat:"물품", type:"내자", date:"2026-02-10", deadline:"2026-03-09", mgr:"황유진" },
    { n:52, client:"KIOST", contact:"이수환", mfr:"SIG", name:"Reverspark 2000", cat:"물품", type:"내자", date:"2026-02-10", deadline:"2026-04-10", mgr:"오원진" },
    { n:53, client:"KIOST", contact:"정종민", mfr:"Miros", name:"SM-050", cat:"물품", type:"내자", date:"2026-02-12", deadline:"2026-06-15", mgr:"하선종" },
    { n:54, client:"한화시스템", contact:"이성엽", mfr:"Teledyne Benthos", name:"R500 용 배터리", cat:"물품", type:"내자", date:"2026-02-12", deadline:"2026-02-19", mgr:"이학용" },
    { n:55, client:"KHOA", contact:"", mfr:"오션테크", name:"2026년 해양관측부이 차세대 데이터로거 물품 제작", cat:"물품", type:"내자", date:"2026-02-19", deadline:"2026-04-20", mgr:"기술팀" },
    { n:56, client:"대양전기공업", contact:"", mfr:"Metocean", name:"ST400B", cat:"물품", type:"내자", date:"2026-02-20", deadline:"", mgr:"황유진" },
    { n:57, client:"KHOA", contact:"고준철", mfr:"오션테크", name:"평택당진항 보험", cat:"물품", type:"내자", date:"", deadline:"", mgr:"사업부" },
    { n:58, client:"KIOST", contact:"김병남", mfr:"Benthos", name:"R500 1식", cat:"물품", type:"내자", date:"2026-02-23", deadline:"2026-03-31", mgr:"오원진" },
    { n:59, client:"KHOA", contact:"고준철", mfr:"오션테크", name:"태안항 해양관측부이 긴급점검", cat:"용역", type:"내자", date:"2026-02-04", deadline:"2026-02-12", mgr:"이형준" },
    { n:60, client:"KHOA", contact:"", mfr:"오션테크", name:"2026년 해양위성정보 품질관리 체계 고도화", cat:"용역", type:"내자", date:"2026-02-24", deadline:"2026-12-10", mgr:"" },
    { n:61, client:"세광종합기술단", contact:"조영흠", mfr:"GNM", name:"Niskin 5L", cat:"물품", type:"내자", date:"2026-02-25", deadline:"", mgr:"오원진" },
    { n:62, client:"MRC", contact:"임성진", mfr:"Oceaneering", name:"C-Nav 보정신호 1개월", cat:"물품", type:"내자", date:"2026-02-25", deadline:"", mgr:"현지윤" },
  ];

  for (const c of contracts) {
    const num = `#26-${String(c.n).padStart(2, "0")}`;
    await prisma.contract.upsert({
      where: { contractNumber: num },
      update: {
        client: c.client,
        name: c.name,
        manufacturer: c.mfr || null,
        clientContact: c.contact || null,
        category: c.cat,
        contractType: c.type,
        contractDate: c.date ? new Date(c.date) : null,
        deadline: c.deadline ? new Date(c.deadline) : null,
        manager: c.mgr || null,
      },
      create: {
        contractNumber: num,
        client: c.client,
        name: c.name,
        manufacturer: c.mfr || null,
        clientContact: c.contact || null,
        category: c.cat,
        contractType: c.type,
        contractDate: c.date ? new Date(c.date) : null,
        deadline: c.deadline ? new Date(c.deadline) : null,
        manager: c.mgr || null,
      },
    });
  }
  console.log(`Seeded ${contracts.length} contracts`);

  // ─── 제조사/공급사 시드 (계약 데이터에서 추출) ─────────────────────────
  const manufacturers = [...new Set(contracts.map((c) => c.mfr).filter(Boolean))];
  for (const name of manufacturers) {
    await prisma.supplier.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Seeded ${manufacturers.length} suppliers`);

  // ─── 고객사 시드 (계약 데이터에서 추출 + 추가 정보) ─────────────────────
  const customerMap: Record<string, { contact?: string; phone?: string; businessNo?: string }> = {
    "엘티메트릭": { contact: "이혁" },
    "KIGAM": { contact: "이한희", businessNo: "042-868-3000" },
    "에이샛": { contact: "송성의" },
    "고려조선": {},
    "KHOA": { businessNo: "051-400-4500" },
    "지오뷰": { contact: "김민중" },
    "엔스케이프㈜": { contact: "소영덕" },
    "KOPRI": { contact: "조자연", businessNo: "032-770-8500" },
    "KIOST": { contact: "강한구", businessNo: "051-664-3000" },
    "한국기상산업기술원": { contact: "서성희" },
    "KAI": { contact: "전영탁" },
    "MRC": { contact: "임성진" },
    "오션웨이브": {},
    "세광종합기술단": { contact: "김지희" },
    "금강물환경센터": {},
    "서울대학교": { contact: "한종훈" },
    "KOINS": { contact: "심재진" },
    "해안해양기술": { contact: "김종덕" },
    "UST21": { contact: "신수철" },
    "지오시스템리서치": { contact: "박문상" },
    "오셔닉": { contact: "박지민" },
    "인터오션": { contact: "배재민" },
    "MIT": { contact: "박태홍" },
    "퓨어넥스": { contact: "김우람" },
    "국립수산과학원": { contact: "김상일" },
    "한화시스템": { contact: "이성엽" },
    "대양전기공업": {},
  };

  // 중복 고객사 병합 (KHOA(동해), KHOA(서해), KHOA(남해) → KHOA)
  const mergeTargets: Record<string, string> = {
    "KHOA(동해)": "KHOA",
    "KHOA(서해)": "KHOA",
    "KHOA(남해)": "KHOA",
  };
  for (const [oldName, newName] of Object.entries(mergeTargets)) {
    const old = await prisma.customer.findFirst({ where: { name: oldName } });
    if (old) {
      let target = await prisma.customer.findFirst({ where: { name: newName } });
      if (target) {
        await prisma.customerAsset.updateMany({ where: { customerId: old.id }, data: { customerId: target.id } });
        await prisma.repairOrder.updateMany({ where: { customerId: old.id }, data: { customerId: target.id } });
        await prisma.customerContact.updateMany({ where: { customerId: old.id }, data: { customerId: target.id } });
        await prisma.contract.updateMany({ where: { client: oldName }, data: { client: newName } });
        await prisma.customer.delete({ where: { id: old.id } });
        console.log(`Merged customer "${oldName}" → "${newName}"`);
      } else {
        await prisma.customer.update({ where: { id: old.id }, data: { name: newName } });
        console.log(`Renamed customer "${oldName}" → "${newName}"`);
      }
    }
  }

  const customerNames = [...new Set(contracts.map((c) => c.client))];
  const customerIds: Record<string, string> = {};
  for (const name of customerNames) {
    const info = customerMap[name] || {};
    let customer = await prisma.customer.findFirst({ where: { name } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { name, contactPerson: info.contact || null, businessNo: info.businessNo || null },
      });
    }
    customerIds[name] = customer.id;
  }
  console.log(`Seeded ${customerNames.length} customers`);

  // ─── 카테고리 시드 ─────────────────────────────────────────────────────
  const categories = [
    { name: "수중음향", type: "EQUIPMENT" },
    { name: "해양관측", type: "EQUIPMENT" },
    { name: "항해측위", type: "EQUIPMENT" },
    { name: "수중작업", type: "EQUIPMENT" },
    { name: "계류시스템", type: "EQUIPMENT" },
    { name: "음향측심", type: "SENSOR" },
    { name: "해양센서", type: "SENSOR" },
    { name: "위치측위", type: "SENSOR" },
    { name: "기상관측", type: "SENSOR" },
    { name: "수질측정", type: "SENSOR" },
  ];

  const catIds: Record<string, string> = {};
  for (const cat of categories) {
    const result = await prisma.category.upsert({
      where: { name_type: { name: cat.name, type: cat.type } },
      update: {},
      create: { name: cat.name, type: cat.type },
    });
    catIds[`${cat.type}:${cat.name}`] = result.id;
  }
  console.log(`Seeded ${categories.length} categories`);

  // ─── 장비 시드 ─────────────────────────────────────────────────────────
  const equipmentList = [
    { name: "USV-1 (무인수상정)", serial: "USV-2024-001", mfr: "오션테크", model: "OT-USV-300", cat: "수중작업", desc: "자율운항 무인수상정" },
    { name: "USV-2 (무인수상정)", serial: "USV-2024-002", mfr: "오션테크", model: "OT-USV-300", cat: "수중작업", desc: "자율운항 무인수상정 2호기" },
    { name: "AUV (자율무인잠수정)", serial: "AUV-2023-001", mfr: "오션테크", model: "OT-AUV-500", cat: "수중작업", desc: "심해 탐사용 AUV" },
    { name: "멀티빔 음향측심기 T50", serial: "T50-2022-001", mfr: "Reson", model: "SeaBat T50", cat: "수중음향", desc: "고해상도 해저 지형 측량" },
    { name: "멀티빔 음향측심기 T50-P", serial: "T50P-2023-001", mfr: "Reson", model: "SeaBat T50-P", cat: "수중음향", desc: "휴대형 멀티빔" },
    { name: "사이드스캔소나", serial: "SSS-2023-001", mfr: "Geometrics", model: "GeoSwath Plus", cat: "수중음향", desc: "해저면 영상 탐사" },
    { name: "해양관측부이 #1", serial: "BUOY-2024-001", mfr: "오션테크", model: "OT-BUOY-M1", cat: "해양관측", desc: "해양환경 실시간 관측" },
    { name: "해양관측부이 #2", serial: "BUOY-2024-002", mfr: "오션테크", model: "OT-BUOY-M1", cat: "해양관측", desc: "해양환경 실시간 관측 2호" },
    { name: "해양관측부이 #3", serial: "BUOY-2024-003", mfr: "오션테크", model: "OT-BUOY-M2", cat: "해양관측", desc: "차세대 데이터로거 탑재" },
    { name: "DGPS 기준국", serial: "DGPS-2021-001", mfr: "Oceaneering", model: "C-Nav 3050", cat: "항해측위", desc: "정밀 위치측위 시스템" },
    { name: "피스톤 시추기", serial: "CORE-2025-001", mfr: "오션테크", model: "OT-PC-10M", cat: "해양관측", desc: "해저 퇴적물 시추" },
    { name: "XRF 코어 스캐너", serial: "XRF-2020-001", mfr: "오션테크", model: "OT-XRF-200", cat: "해양관측", desc: "코어 시료 원소 분석" },
    { name: "박스코어러", serial: "BOX-2019-001", mfr: "오션테크", model: "OT-BC-50", cat: "해양관측", desc: "해저면 표층 시료 채취" },
    { name: "GNSS 수신기", serial: "GNSS-2023-001", mfr: "Oceaneering", model: "Atlas H10", cat: "항해측위", desc: "고정밀 위성 항법" },
    { name: "계류시스템 #1", serial: "MOOR-2024-001", mfr: "오션테크", model: "OT-MOOR-D500", cat: "계류시스템", desc: "심해 계류 관측 시스템" },
  ];

  for (const eq of equipmentList) {
    const catId = catIds[`EQUIPMENT:${eq.cat}`];
    if (!catId) continue;
    await prisma.equipment.upsert({
      where: { serialNumber: eq.serial },
      update: {},
      create: {
        categoryId: catId,
        name: eq.name,
        serialNumber: eq.serial,
        manufacturer: eq.mfr,
        model: eq.model,
        description: eq.desc,
        status: "AVAILABLE",
        createdBy: "system",
      },
    });
  }
  console.log(`Seeded ${equipmentList.length} equipment`);

  // ─── 센서 시드 ─────────────────────────────────────────────────────────
  const sensorList = [
    { name: "DCPS 유속계 #1", serial: "DCPS-2023-001", mfr: "AADI", model: "SeaGuard II DCP", cat: "해양센서", calDays: 365 },
    { name: "DCPS 유속계 #2", serial: "DCPS-2023-002", mfr: "AADI", model: "SeaGuard II DCP", cat: "해양센서", calDays: 365 },
    { name: "압력식 조위계 #1", serial: "TIDE-2022-001", mfr: "AADI", model: "WLR-7", cat: "해양센서", calDays: 365 },
    { name: "압력식 조위계 #2", serial: "TIDE-2022-002", mfr: "AADI", model: "WLR-7", cat: "해양센서", calDays: 365 },
    { name: "해상중력계", serial: "GRAV-2025-001", mfr: "ZLS", model: "UltraSys", cat: "해양센서", calDays: 730 },
    { name: "수중음향위치추적기", serial: "USBL-2023-001", mfr: "Benthos", model: "R500", cat: "음향측심", calDays: 365 },
    { name: "수중음향위치추적기 #2", serial: "USBL-2024-001", mfr: "Benthos", model: "R500", cat: "음향측심", calDays: 365 },
    { name: "수심측정기 UPR #1", serial: "UPR-2024-001", mfr: "오션테크", model: "OT-UPR-100", cat: "해양센서", calDays: 180 },
    { name: "수심측정기 UPR #2", serial: "UPR-2024-002", mfr: "오션테크", model: "OT-UPR-100", cat: "해양센서", calDays: 180 },
    { name: "수심측정기 UPR #3", serial: "UPR-2024-003", mfr: "오션테크", model: "OT-UPR-100", cat: "해양센서", calDays: 180 },
    { name: "파고계", serial: "WAVE-2023-001", mfr: "Miros", model: "SM-050", cat: "기상관측", calDays: 365 },
    { name: "해양자력계", serial: "MAG-2022-001", mfr: "Marine Magnetics", model: "SeaSPY2", cat: "해양센서", calDays: 365 },
    { name: "수중통신모뎀", serial: "ACM-2023-001", mfr: "Teledyne Benthos", model: "ATM-900", cat: "음향측심", calDays: 365 },
    { name: "CTD 센서", serial: "CTD-2023-001", mfr: "SIG", model: "M2", cat: "수질측정", calDays: 180 },
    { name: "위성추적장치", serial: "SAT-2024-001", mfr: "Metocean", model: "ST400B", cat: "위치측위", calDays: 365 },
    { name: "수중조명", serial: "LIGHT-2024-001", mfr: "Deepsea", model: "LSL-2000", cat: "해양센서", calDays: 0 },
    { name: "수중조명 #2", serial: "LIGHT-2024-002", mfr: "Deepsea", model: "LSL-2000", cat: "해양센서", calDays: 0 },
    { name: "레퍼런스 센서", serial: "REF-2024-001", mfr: "Sea Ocean", model: "SO-REF-100", cat: "해양센서", calDays: 365 },
  ];

  for (const sn of sensorList) {
    const catId = catIds[`SENSOR:${sn.cat}`];
    if (!catId) continue;
    await prisma.sensor.upsert({
      where: { serialNumber: sn.serial },
      update: {},
      create: {
        categoryId: catId,
        name: sn.name,
        serialNumber: sn.serial,
        manufacturer: sn.mfr,
        model: sn.model,
        calibrationIntervalDays: sn.calDays || null,
        status: "AVAILABLE",
        createdBy: "system",
      },
    });
  }
  console.log(`Seeded ${sensorList.length} sensors`);

  // ─── 부품 시드 ─────────────────────────────────────────────────────────
  const partsList = [
    { pn: "PT-BAT-001", name: "865 Battery", mfr: "Benthos", cat: "배터리", price: 850000, qty: 5, min: 2 },
    { pn: "PT-BAT-002", name: "R12K Battery", mfr: "Benthos", cat: "배터리", price: 1200000, qty: 3, min: 2 },
    { pn: "PT-BAT-003", name: "R500 Battery Pack", mfr: "Teledyne Benthos", cat: "배터리", price: 1500000, qty: 4, min: 2 },
    { pn: "PT-CBL-001", name: "Armoured Cable 500m", mfr: "Geometrics", cat: "케이블", price: 8500000, qty: 2, min: 1 },
    { pn: "PT-CBL-002", name: "Data Cable 50m", mfr: "오션테크", cat: "케이블", price: 350000, qty: 8, min: 3 },
    { pn: "PT-CBL-003", name: "DCPS용 10m Cable", mfr: "AADI", cat: "케이블", price: 450000, qty: 6, min: 2 },
    { pn: "PT-CBL-004", name: "GNSS 케이블 20m", mfr: "오션테크", cat: "케이블", price: 280000, qty: 5, min: 2 },
    { pn: "PT-HSG-001", name: "수중배터리 하우징", mfr: "인현산업", cat: "하우징", price: 2500000, qty: 3, min: 1 },
    { pn: "PT-HSG-002", name: "수중 벌크헤드 커넥터", mfr: "인현산업", cat: "커넥터", price: 180000, qty: 10, min: 5 },
    { pn: "PT-BUO-001", name: "Glass Buoy", mfr: "Nautilus", cat: "부이", price: 650000, qty: 12, min: 5 },
    { pn: "PT-PSU-001", name: "Power Supply Unit", mfr: "SIG", cat: "전원", price: 1800000, qty: 2, min: 1 },
    { pn: "PT-HYD-001", name: "Hydrophone", mfr: "Reson", cat: "센서부품", price: 3200000, qty: 3, min: 1 },
    { pn: "PT-NSK-001", name: "Niskin 5L", mfr: "GNM", cat: "채수기", price: 420000, qty: 6, min: 3 },
  ];

  for (const pt of partsList) {
    const existing = await prisma.part.findFirst({ where: { partNumber: pt.pn } });
    if (!existing) {
      await prisma.part.create({
        data: {
          partNumber: pt.pn,
          name: pt.name,
          manufacturer: pt.mfr,
          category: pt.cat,
          unitPrice: pt.price,
          stockQuantity: pt.qty,
          minStockLevel: pt.min,
        },
      });
    }
  }
  console.log(`Seeded ${partsList.length} parts`);

  // ─── 수리 접수 시드 ────────────────────────────────────────────────────
  const repairSeeds = [
    { orderNum: "AS-2026-001", type: "REPAIR", status: "COMPLETED", priority: "HIGH", customer: "UST21", symptom: "T50 Dual Head 소나 노이즈 발생", location: "본사", receivedBy: "현지윤" },
    { orderNum: "AS-2026-002", type: "REPAIR", status: "REPAIRING", priority: "NORMAL", customer: "KHOA", contactName: "최효근", notes: "KHOA 남해", symptom: "SeaSPY2 자력계 데이터 이상", location: "본사", receivedBy: "김재엽" },
    { orderNum: "AS-2026-003", type: "REPAIR", status: "SHIPPED_TO_MFG", priority: "NORMAL", customer: "지오시스템리서치", symptom: "T50-P 수중 커넥터 침수", location: "본사 → 제조사", receivedBy: "현지윤" },
    { orderNum: "AS-2026-004", type: "REPAIR", status: "INSPECTING_1ST", priority: "URGENT", customer: "KIOST", symptom: "SIG M2 CTD 센서 측정값 오차 증가", location: "본사", receivedBy: "오원진" },
    { orderNum: "AS-2026-005", type: "REPAIR", status: "RECEIVED", priority: "NORMAL", customer: "국립수산과학원", symptom: "박스코어 와이어 마모", location: "본사", receivedBy: "하선종" },
    { orderNum: "AS-2026-006", type: "DELIVERY", status: "INSPECTING_1ST", priority: "NORMAL", customer: "KOPRI", symptom: "피스톤 시추기 납품 전 점검", location: "본사", receivedBy: "강성화" },
    { orderNum: "AS-2026-007", type: "REPAIR", status: "QUOTED", priority: "HIGH", customer: "KIOST", symptom: "Microsec Sting 전원부 고장", location: "본사", receivedBy: "오원진" },
  ];

  for (const r of repairSeeds) {
    const existing = await prisma.repairOrder.findFirst({ where: { orderNumber: r.orderNum } });
    if (existing) continue;
    const custId = customerIds[r.customer];
    await prisma.repairOrder.create({
      data: {
        orderNumber: r.orderNum,
        orderType: r.type as any,
        status: r.status as any,
        priority: r.priority as any,
        customerId: custId || null,
        symptom: r.symptom,
        currentLocation: r.location,
        receivedBy: r.receivedBy,
        receivedAt: new Date("2026-01-15"),
      },
    });
  }
  console.log(`Seeded ${repairSeeds.length} repair orders`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
