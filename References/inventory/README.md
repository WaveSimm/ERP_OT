# inventory — 재고/장비 마이그레이션 입력

- **대응 스크립트**: `services/equipment/prisma/migrate-inventory.ts`
  - ⚠️ 이 스크립트는 equipment 서비스의 Prisma 와 강결합돼 있어 **서비스 디렉터리에 그대로 둡니다**(References 로 이동 불가). 여기엔 입력 데이터만 둡니다.
- **자동 인식**: `References/inventory/합본_전체본.xlsx`
- **파일명 규칙**: `합본_전체본.xlsx` (정확한 이름)
- **실행**: equipment 서비스 컨텍스트에서 해당 ts 스크립트 실행 (서비스 README/패키지 스크립트 참고)

> 현재 `합본_전체본.xlsx` 원본은 아직 이 폴더에 없습니다. 마이그레이션 시 이 이름으로 넣어주세요.
