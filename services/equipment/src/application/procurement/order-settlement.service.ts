import { PrismaClient, OrderCurrency } from "@prisma/client";

/**
 * 회계정산 (Settlement) 서비스 — v1.6 (2026-05-14)
 *  - 발주 1건당 Invoice 1개 (1:1)
 *  - Invoice 수정 시 amendment 이력 row 자동 생성
 *  - 발주 1건당 다건 송금(Payment)
 */
export class OrderSettlementService {
  constructor(private prisma: PrismaClient) {}

  // ─── Invoice ─────────────────────────────────────────────

  async getInvoice(orderId: string) {
    return this.prisma.orderInvoice.findUnique({
      where: { orderId },
      include: { amendments: { orderBy: { createdAt: "desc" } } },
    });
  }

  async createInvoice(orderId: string, data: {
    invoiceNumber: string;
    invoiceDate: string;
    amount: number;
    currency: OrderCurrency;
    amountKRW?: number;
    dueDate?: string;
    paymentTerms?: string;
    notes?: string;
  }) {
    const exists = await this.prisma.orderInvoice.findUnique({ where: { orderId } });
    if (exists) throw new Error("이미 Invoice가 등록되어 있습니다. 수정을 사용하십시오.");

    return this.prisma.orderInvoice.create({
      data: {
        orderId,
        invoiceNumber: data.invoiceNumber,
        invoiceDate: new Date(data.invoiceDate),
        amount: data.amount,
        initialAmount: data.amount,
        currency: data.currency,
        ...(data.amountKRW !== undefined && { amountKRW: data.amountKRW }),
        ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
        ...(data.paymentTerms !== undefined && { paymentTerms: data.paymentTerms }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  async updateInvoice(orderId: string, data: {
    invoiceNumber?: string;
    invoiceDate?: string;
    amount?: number;
    currency?: OrderCurrency;
    amountKRW?: number | null;
    dueDate?: string | null;
    paymentTerms?: string | null;
    notes?: string | null;
    amendReason?: string;
    amendDescription?: string;
  }, userId?: string) {
    const invoice = await this.prisma.orderInvoice.findUnique({ where: { orderId } });
    if (!invoice) throw new Error("Invoice가 없습니다. 먼저 등록하십시오.");

    const previousAmount = Number(invoice.amount);
    const newAmount = data.amount !== undefined ? Number(data.amount) : previousAmount;
    const amountChanged = newAmount !== previousAmount;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.orderInvoice.update({
        where: { orderId },
        data: {
          ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
          ...(data.invoiceDate !== undefined && { invoiceDate: new Date(data.invoiceDate) }),
          ...(data.amount !== undefined && { amount: data.amount }),
          ...(data.currency !== undefined && { currency: data.currency }),
          ...(data.amountKRW !== undefined && { amountKRW: data.amountKRW }),
          ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
          ...(data.paymentTerms !== undefined && { paymentTerms: data.paymentTerms }),
          ...(data.notes !== undefined && { notes: data.notes }),
        },
        include: { amendments: { orderBy: { createdAt: "desc" } } },
      });

      // 금액 변경 시 amendment row 기록
      if (amountChanged) {
        await tx.orderInvoiceAmendment.create({
          data: {
            invoiceId: invoice.id,
            previousAmount,
            newAmount,
            reason: data.amendReason || "기타",
            ...(data.amendDescription !== undefined && { description: data.amendDescription }),
            ...(userId !== undefined && { amendedBy: userId }),
          },
        });
      }

      return updated;
    });
  }

  // ─── Payment ─────────────────────────────────────────────

  async listPayments(orderId: string) {
    return this.prisma.orderPayment.findMany({
      where: { orderId },
      orderBy: { paymentDate: "asc" },
    });
  }

  /** 송금 직접 등록 (재무팀이 이미 송금 완료한 건을 직접 기록). status=COMPLETED */
  async createPayment(orderId: string, data: {
    paymentDate: string;
    amount: number;
    currency: OrderCurrency;
    amountKRW?: number;
    exchangeRate?: number;
    paymentMethod?: string;
    bankReference?: string;
    notes?: string;
  }, userId?: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");

    return this.prisma.orderPayment.create({
      data: {
        orderId,
        paymentDate: new Date(data.paymentDate),
        amount: data.amount,
        currency: data.currency,
        status: "COMPLETED",
        ...(data.amountKRW !== undefined && { amountKRW: data.amountKRW }),
        ...(data.exchangeRate !== undefined && { exchangeRate: data.exchangeRate }),
        ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
        ...(data.bankReference !== undefined && { bankReference: data.bankReference }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(userId !== undefined && { createdBy: userId, completedBy: userId }),
        completedAt: new Date(),
      },
    });
  }

  // ─── 송금 요청 워크플로우 (v1.6, 2026-05-14) ─────────────────────

  /** 발주 담당자가 송금을 요청 — 재무팀 큐에 들어감 */
  async requestPayment(orderId: string, data: {
    amount: number;
    currency: OrderCurrency;
    paymentMethod?: string;
    notes?: string;
  }, userId?: string) {
    const order = await this.prisma.overseasOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("발주를 찾을 수 없습니다.");

    return this.prisma.orderPayment.create({
      data: {
        orderId,
        amount: data.amount,
        currency: data.currency,
        status: "REQUESTED",
        ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(userId !== undefined && { createdBy: userId, requestedBy: userId }),
        requestedAt: new Date(),
      },
    });
  }

  /**
   * 재무팀이 송금 완료 처리.
   *   - data.amount 가 원본 요청 금액보다 작으면 **부분 결제** 처리:
   *     원본 → COMPLETED(실제 송금액)
   *     잔여 금액 → 새 REQUESTED 자동 생성 (재무팀 큐에 다시 올라옴)
   *   - data.amount 가 같거나 더 크면 단일 COMPLETED 처리
   */
  async completePaymentRequest(paymentId: string, data: {
    paymentDate: string;
    amount?: number;
    amountKRW?: number;
    exchangeRate?: number;
    paymentMethod?: string;
    bankReference?: string;
    notes?: string;
  }, userId?: string) {
    const payment = await this.prisma.orderPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("송금 내역을 찾을 수 없습니다.");
    if (payment.status !== "REQUESTED") throw new Error(`요청 상태(REQUESTED)에서만 완료 처리할 수 있습니다. 현재: ${payment.status}`);

    const originalAmount = Number(payment.amount);
    const actualAmount = data.amount !== undefined ? Number(data.amount) : originalAmount;
    if (actualAmount <= 0) throw new Error("송금액은 0보다 커야 합니다.");
    if (actualAmount > originalAmount) {
      // 더 보낸 케이스는 별도 처리 필요 — 일단 허용 (overpaid)
    }
    const remaining = originalAmount - actualAmount;
    const isPartial = remaining > 0;

    return this.prisma.$transaction(async (tx) => {
      // 1) 원본 요청 → COMPLETED (실제 송금액)
      const completed = await tx.orderPayment.update({
        where: { id: paymentId },
        data: {
          status: "COMPLETED",
          paymentDate: new Date(data.paymentDate),
          amount: actualAmount,
          ...(data.amountKRW !== undefined && { amountKRW: data.amountKRW }),
          ...(data.exchangeRate !== undefined && { exchangeRate: data.exchangeRate }),
          ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
          ...(data.bankReference !== undefined && { bankReference: data.bankReference }),
          ...(data.notes !== undefined && { notes: data.notes }),
          ...(userId !== undefined && { completedBy: userId }),
          completedAt: new Date(),
        },
      });

      // 2) 부분 결제면 잔여 금액으로 새 REQUESTED 자동 생성
      let remainingPayment: any = null;
      if (isPartial) {
        remainingPayment = await tx.orderPayment.create({
          data: {
            orderId: payment.orderId,
            amount: remaining,
            currency: payment.currency,
            status: "REQUESTED",
            paymentMethod: payment.paymentMethod ?? null,
            notes: `부분 결제 잔여 (원본 요청: ${originalAmount.toLocaleString()} ${payment.currency}, 1차 송금: ${actualAmount.toLocaleString()})`,
            ...(userId !== undefined && { createdBy: userId, requestedBy: userId }),
            requestedAt: new Date(),
          },
        });
      }

      return { completed, remainingPayment, isPartial };
    });
  }

  /** 재무팀이 송금 요청 반려 */
  async rejectPaymentRequest(paymentId: string, reason: string, _userId?: string) {
    const payment = await this.prisma.orderPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("송금 내역을 찾을 수 없습니다.");
    if (payment.status !== "REQUESTED") throw new Error(`요청 상태(REQUESTED)에서만 반려할 수 있습니다. 현재: ${payment.status}`);
    if (!reason || !reason.trim()) throw new Error("반려 사유는 필수입니다.");

    return this.prisma.orderPayment.update({
      where: { id: paymentId },
      data: {
        status: "REJECTED",
        rejectReason: reason.trim(),
      },
    });
  }

  /** REQUESTED 상태인 송금 요청 목록 (재무팀 큐) */
  async listPaymentRequests(status?: "REQUESTED" | "COMPLETED" | "REJECTED") {
    return this.prisma.orderPayment.findMany({
      where: status ? { status } : { status: "REQUESTED" },
      include: {
        order: {
          select: { id: true, orderNumber: true, manufacturer: true, customer: true, currency: true, totalAmount: true },
        },
      },
      orderBy: { requestedAt: "desc" },
    });
  }

  async updatePayment(paymentId: string, data: {
    paymentDate?: string;
    amount?: number;
    currency?: OrderCurrency;
    amountKRW?: number | null;
    exchangeRate?: number | null;
    paymentMethod?: string | null;
    bankReference?: string | null;
    notes?: string | null;
  }) {
    const payment = await this.prisma.orderPayment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new Error("송금 내역을 찾을 수 없습니다.");

    return this.prisma.orderPayment.update({
      where: { id: paymentId },
      data: {
        ...(data.paymentDate !== undefined && { paymentDate: new Date(data.paymentDate) }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.amountKRW !== undefined && { amountKRW: data.amountKRW }),
        ...(data.exchangeRate !== undefined && { exchangeRate: data.exchangeRate }),
        ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod }),
        ...(data.bankReference !== undefined && { bankReference: data.bankReference }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  async deletePayment(paymentId: string) {
    return this.prisma.orderPayment.delete({ where: { id: paymentId } });
  }

  // ─── Summary ─────────────────────────────────────────────

  async getSummary(orderId: string) {
    const [invoice, payments] = await Promise.all([
      this.getInvoice(orderId),
      this.listPayments(orderId),
    ]);

    const invoicedAmount = invoice ? Number(invoice.amount) : 0;
    // v1.6 (2026-05-14): COMPLETED만 합산. REQUESTED/REJECTED는 잔여 계산 제외
    const totalPaid = payments
      .filter((p: any) => p.status === "COMPLETED")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const totalRequested = payments
      .filter((p: any) => p.status === "REQUESTED")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const outstanding = invoicedAmount - totalPaid;
    const fullyPaid = invoicedAmount > 0 && outstanding <= 0;

    return {
      invoice,
      payments,
      summary: {
        invoicedAmount,
        totalPaid,
        totalRequested,        // 요청 중인 금액 합계 (참고용)
        outstanding,
        fullyPaid,
        currency: invoice?.currency || payments[0]?.currency || null,
      },
    };
  }
}
