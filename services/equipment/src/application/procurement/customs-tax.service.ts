import { PrismaClient, CustomsTaxStatus } from "@prisma/client";

/**
 * 관부가세 처리 서비스 (v1.6.1, 2026-05-15)
 *
 * 흐름:
 *  1. 발주 SHIPPED → CUSTOMS 전이 시 OrderCustomsTax(PENDING) 자동 생성 (transition()에서 호출)
 *  2. 재무팀이 금액 입력 + 납부 완료 (PAID) 또는 반려 (REJECTED)
 *  3. 발주 측에서 CUSTOMS → ARRIVED 전이 시 status===PAID 검증
 */
export class CustomsTaxService {
  constructor(private readonly prisma: PrismaClient) {}

  /** 통관 시작 — PENDING row 생성 (transition() 에서 자동 호출) */
  async start(orderId: string, userId?: string) {
    const exists = await this.prisma.orderCustomsTax.findUnique({ where: { orderId } });
    if (exists) return exists;
    return this.prisma.orderCustomsTax.create({
      data: {
        orderId,
        status: "PENDING",
        ...(userId && { startedBy: userId }),
      },
    });
  }

  /** 발주별 관부가세 조회 */
  async getByOrder(orderId: string) {
    return this.prisma.orderCustomsTax.findUnique({ where: { orderId } });
  }

  /** 재무팀 큐 — status 필터 */
  async list(status?: CustomsTaxStatus) {
    return this.prisma.orderCustomsTax.findMany({
      where: status ? { status } : { status: "PENDING" },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, manufacturer: true, customer: true,
            currency: true, totalAmount: true, customsDate: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
    });
  }

  /** 재무팀 — 납부 완료 처리 */
  async pay(id: string, data: {
    customsDuty?: number;
    vat?: number;
    totalAmount?: number;
    paidAt?: string;
    notes?: string;
  }, userId?: string, userName?: string) {
    const tax = await this.prisma.orderCustomsTax.findUnique({ where: { id } });
    if (!tax) throw new Error("관부가세 레코드를 찾을 수 없습니다.");
    if (tax.status === "PAID") throw new Error("이미 납부 완료된 관부가세입니다.");

    return this.prisma.orderCustomsTax.update({
      where: { id },
      data: {
        status: "PAID",
        ...(data.customsDuty !== undefined && { customsDuty: data.customsDuty }),
        ...(data.vat !== undefined && { vat: data.vat }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        ...(userId && { paidBy: userId }),
        ...(userName && { paidByName: userName }),
      },
    });
  }

  /** 재무팀 — PAID 정정 (오기·휴먼 에러 보정) */
  async correct(id: string, data: {
    customsDuty?: number;
    vat?: number;
    totalAmount?: number;
    paidAt?: string;
    notes?: string;
  }) {
    const tax = await this.prisma.orderCustomsTax.findUnique({ where: { id } });
    if (!tax) throw new Error("관부가세 레코드를 찾을 수 없습니다.");
    if (tax.status !== "PAID") throw new Error("PAID 상태만 정정할 수 있습니다.");
    return this.prisma.orderCustomsTax.update({
      where: { id },
      data: {
        ...(data.customsDuty !== undefined && { customsDuty: data.customsDuty }),
        ...(data.vat !== undefined && { vat: data.vat }),
        ...(data.totalAmount !== undefined && { totalAmount: data.totalAmount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.paidAt && { paidAt: new Date(data.paidAt) }),
      },
    });
  }

  /** 재무팀 — 반려 */
  async reject(id: string, reason: string, _userId?: string) {
    const tax = await this.prisma.orderCustomsTax.findUnique({ where: { id } });
    if (!tax) throw new Error("관부가세 레코드를 찾을 수 없습니다.");
    return this.prisma.orderCustomsTax.update({
      where: { id },
      data: { status: "REJECTED", rejectReason: reason },
    });
  }

  /** 반려 → PENDING 재개 */
  async reopen(id: string) {
    return this.prisma.orderCustomsTax.update({
      where: { id },
      data: { status: "PENDING", rejectReason: null },
    });
  }
}
