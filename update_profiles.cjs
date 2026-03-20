'use strict';
// update_profiles.cjs — run inside erp-ot-auth container
// 주소록.xlsx 데이터로 UserProfile 업데이트 (부서, 내선번호, 휴대폰)

const { PrismaClient } = require('/app/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client');

// 부서명 → resource_group id 매핑
const DEPT_IDS = {
  '임원':        'cmmyl3ef800177v8fkcjfqs92',   // 경영
  '경영지원팀':  'cmmyjx5lx000x7v8f0zc0ml5t',   // 관리팀
  '무인사업1팀': 'cmmyjx2dn000t7v8fryfc9lzi',   // 무인1팀
  '무인사업2팀': 'cmmym4pxv001j7v8fhxfkhvwj',   // 무인2팀
  '사업1팀':     'cmmyjwwoh000p7v8fyk5ruu2p',
  '사업2팀':     'cmmynirpg001l7v8fo6csybx4',
  '사업3팀':     'cmmyjxmou00117v8f6cffttpu',
  '기술팀':      'cmmwluwqo0001g1bhjiao6hqf',
  '영업1팀':     '059e316c-19ae-4548-90b9-82f764e3dd22',
  '영업2팀':     '1868e1e5-a8f9-47dc-8a5b-b67fc17e22ec',
  '재무팀':      'df8a3942-1606-436d-bf24-b395335b88cc',
};

// 주소록.xlsx 데이터 (팀, 이름, 내선번호, 휴대폰)
const ADDRESS_BOOK = [
  { name: '홍성두', dept: '임원',        ext: '9001', mobile: '010-4373-8495' },
  { name: '이기욱', dept: '임원',        ext: '9002', mobile: '010-2322-8495' },
  { name: '문홍배', dept: '임원',        ext: '9081', mobile: '010-8628-3427' },
  { name: '하선종', dept: '영업1팀',     ext: '9021', mobile: '010-9030-1815' },
  { name: '이학용', dept: '영업1팀',     ext: '9022', mobile: '010-6348-4866' },
  { name: '현지윤', dept: '영업1팀',     ext: '9025', mobile: '010-2960-6431' },
  { name: '강성화', dept: '영업2팀',     ext: '9082', mobile: '010-2019-3132' },
  { name: '오원진', dept: '영업2팀',     ext: '9083', mobile: '010-9302-4589' },
  { name: '황유진', dept: '영업2팀',     ext: '9084', mobile: '010-9262-1853' },
  { name: '김재엽', dept: '영업2팀',     ext: '9085', mobile: '010-7656-1959' },
  { name: '모태준', dept: '무인사업1팀', ext: '9090', mobile: '010-5585-1560' },
  { name: '문성주', dept: '무인사업1팀', ext: '9093', mobile: '010-4316-3736' },
  { name: '이창민', dept: '무인사업1팀', ext: '9095', mobile: '010-6669-3597' },
  { name: '손형석', dept: '무인사업1팀', ext: '9072', mobile: '010-8654-5562' },
  { name: '송인근', dept: '무인사업1팀', ext: '9075', mobile: '010-5163-5403' },
  { name: '황원욱', dept: '무인사업1팀', ext: '9096', mobile: '010-4164-1260' },
  { name: '신용은', dept: '무인사업1팀', ext: '9041', mobile: '010-5443-8479' },
  { name: '이수현', dept: '무인사업2팀', ext: '9092', mobile: '010-2997-2398' },
  { name: '김진수', dept: '무인사업2팀', ext: '9058', mobile: '010-5495-2156' },
  { name: '김정훈', dept: '무인사업2팀', ext: '9094', mobile: '010-5050-9206' },
  { name: '이진호', dept: '무인사업2팀', ext: '9057', mobile: '010-5644-9221' },
  { name: '김만복', dept: '무인사업2팀', ext: '9073', mobile: '010-8923-0769' },
  { name: '고태호', dept: '사업1팀',     ext: '9042', mobile: '010-3552-8066' },
  { name: '한종민', dept: '사업1팀',     ext: '9044', mobile: '010-6394-2818' },
  { name: '이형준', dept: '사업1팀',     ext: '9045', mobile: '010-4627-7586' },
  { name: '이지훈', dept: '사업1팀',     ext: '9064', mobile: '010-7197-5232' },
  { name: '김정민', dept: '사업1팀',     ext: '9047', mobile: '010-5099-6582' },
  { name: '김태현', dept: '사업1팀',     ext: '9091', mobile: '010-2014-8263' },
  { name: '황규하', dept: '사업2팀',     ext: '9032', mobile: '010-3872-0601' },
  { name: '김승환', dept: '사업2팀',     ext: '9063', mobile: '010-4090-3378' },
  { name: '이주학', dept: '사업2팀',     ext: '9043', mobile: '010-5528-3244' },
  { name: '강찬영', dept: '사업2팀',     ext: '9033', mobile: '010-9558-9315' },
  { name: '김문진', dept: '사업2팀',     ext: '9066', mobile: '010-8702-9109' },
  { name: '윤석준', dept: '사업2팀',     ext: '9065', mobile: '010-3379-8795' },
  { name: '문기돈', dept: '사업3팀',     ext: '9020', mobile: '010-5321-0957' },
  { name: '유정연', dept: '사업3팀',     ext: '9062', mobile: '010-9286-9917' },
  { name: '김병태', dept: '사업3팀',     ext: '9031', mobile: '010-9370-8540' },
  { name: '김주연', dept: '사업3팀',     ext: '9037', mobile: '010-2869-2876' },
  { name: '조혁만', dept: '사업3팀',     ext: '9061', mobile: '010-9462-4587' },
  { name: '김민준', dept: '사업3팀',     ext: '9048', mobile: '010-3188-5893' },
  { name: '이승록', dept: '사업3팀',     ext: '9046', mobile: '010-7557-7530' },
  { name: '박민수', dept: '사업3팀',     ext: '9035', mobile: '010-8350-9963' },
  { name: '권오승', dept: '사업3팀',     ext: '9049', mobile: '010-4773-7298' },
  { name: '심윤송', dept: '기술팀',      ext: '9050', mobile: '010-9492-8628' },
  { name: '최창영', dept: '기술팀',      ext: '9053', mobile: '010-9306-8106' },
  { name: '김창온', dept: '기술팀',      ext: '9052', mobile: '010-3207-3949' },
  { name: '홍재용', dept: '기술팀',      ext: '9055', mobile: '010-5440-3487' },
  { name: '이은경', dept: '기술팀',      ext: '9056', mobile: '010-4130-4678' },
  { name: '신대철', dept: '기술팀',      ext: '9059', mobile: '010-8897-3149' },
  { name: '김나예', dept: '기술팀',      ext: '9054', mobile: '010-9080-9054' },
  { name: '최지수', dept: '기술팀',      ext: '9051', mobile: '010-8011-4451' },
  { name: '박고은', dept: '재무팀',      ext: '9011', mobile: '010-9838-3675' },
  { name: '이민지', dept: '재무팀',      ext: '9013', mobile: '010-2037-6844' },
  { name: '류지현', dept: '재무팀',      ext: '9014', mobile: '010-7344-5965' },
  { name: '김대현', dept: '경영지원팀',  ext: '9071', mobile: '010-8513-6295' },
  { name: '홍아름', dept: '경영지원팀',  ext: '9012', mobile: '010-9979-6218' },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();

    // 이름 → userId 맵 (중복 이름은 이메일에 oceant 포함된 것 우선)
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true },
    });

    // 이름별로 그룹핑 (중복 처리)
    const nameMap = {};
    for (const u of users) {
      if (!nameMap[u.name]) {
        nameMap[u.name] = u;
      } else {
        // oceant 도메인 우선, 아니면 email 알파벳 순 첫번째
        const existing = nameMap[u.name];
        if (!existing.email.includes('oceant') && u.email.includes('oceant')) {
          nameMap[u.name] = u;
        }
      }
    }

    let updated = 0, notFound = 0;

    for (const entry of ADDRESS_BOOK) {
      const user = nameMap[entry.name];
      if (!user) {
        console.log(`  NOT FOUND: ${entry.name}`);
        notFound++;
        continue;
      }

      await prisma.userProfile.upsert({
        where:  { userId: user.id },
        create: {
          userId:         user.id,
          departmentId:   DEPT_IDS[entry.dept] || null,
          departmentName: entry.dept,
          phoneOffice:    entry.ext,
          phoneMobile:    entry.mobile,
        },
        update: {
          departmentId:   DEPT_IDS[entry.dept] || null,
          departmentName: entry.dept,
          phoneOffice:    entry.ext,
          phoneMobile:    entry.mobile,
        },
      });

      console.log(`  OK: ${entry.name} (${entry.dept} / ${entry.ext}) → ${user.email}`);
      updated++;
    }

    console.log(`\nDone: ${updated} updated, ${notFound} not found`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
