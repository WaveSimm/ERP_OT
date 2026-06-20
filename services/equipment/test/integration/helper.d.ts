import { PrismaClient } from "@prisma/client";
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/library").DefaultArgs>;
/** equipment 스키마의 모든 테이블 TRUNCATE (FK 무시, identity 리셋) — 테스트 간 격리. */
export declare function truncateAll(): Promise<void>;
export declare function disconnect(): Promise<void>;
//# sourceMappingURL=helper.d.ts.map