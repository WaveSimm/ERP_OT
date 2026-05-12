// approval-service 자동 상신 — EXPENSE_CLAIM 양식
// referenceType="EXPENSE_SETTLEMENT", referenceId=settlement.id 로 연결

export interface ExpenseClaimItem {
  transactedAt: Date;
  merchantName: string;
  categoryName: string;
  amount: number;
  memo: string;
  receiptFileName?: string | null;
}

export interface CreateExpenseClaimInput {
  userId: string;
  settlementId: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  totalAmount: number;
  categoryStats: Record<string, { count: number; amount: number; name: string }>;
  items: ExpenseClaimItem[];
}

export class ApprovalClient {
  constructor(
    private readonly approvalServiceUrl: string,
    private readonly internalToken: string,
  ) {}

  /**
   * 결재 문서 생성 → documentId 반환.
   * POST /internal/documents (templateCode로 lookup, x-internal-token).
   * 결재라인: approval이 auth-service /internal/users/:id/approver 로 자동 로드.
   */
  async createExpenseClaimDocument(input: CreateExpenseClaimInput): Promise<string> {
    // 양식 통합 (2026-05-11) — EXPENSE_CLAIM → EXPENSE 양식 일원화
    // 경비정산 결재를 지출결의서 양식으로 통합 처리
    const body = {
      templateCode: "EXPENSE",
      title: input.title,
      requestedBy: input.userId,
      fields: {
        project: null,
        paymentMethod: "법인카드",
      },
      // EXPENSE 양식의 items_table_config 컬럼: description, unitPrice, quantity, subtotal, vat + evidence(영수증 파일명)
      items: input.items.map((it) => ({
        description: `${it.merchantName}${it.categoryName ? ` (${it.categoryName})` : ""}${it.memo ? ` — ${it.memo}` : ""}`,
        unitPrice: it.amount,
        quantity: 1,
        subtotal: it.amount,
        vat: 0,
        evidence: it.receiptFileName ?? null,
      })),
      totalAmount: input.totalAmount,
      // 결재 완료 후 webhook 라우팅용 — 정산 ID 연결 유지
      referenceType: "EXPENSE_SETTLEMENT",
      referenceId: input.settlementId,
    };

    // approval-service는 사용자 JWT 쿠키 인증이 기본이라 internal endpoint 사용
    const res = await fetch(`${this.approvalServiceUrl}/internal/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": this.internalToken,
      },
      body: JSON.stringify({ ...body, userId: input.userId }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`approval-service ${res.status}: ${txt.slice(0, 300)}`);
    }
    const created = (await res.json()) as { id: string };
    return created.id;
  }

  /**
   * 영수증 파일을 결재 문서의 첨부파일로 업로드.
   * approval-service `/internal/files/upload` (multipart, X-Internal-Token).
   */
  async attachReceipt(input: {
    documentId: string;
    uploadedBy: string;
    fileName: string;
    fileBuffer: Buffer;
    mimeType: string;
  }): Promise<{ id: string } | null> {
    // 주의: fastify-multipart는 파일 파싱 시점에 그 전 필드만 fields에 포함 — 텍스트 필드 먼저
    const fd = new FormData();
    fd.append("documentId", input.documentId);
    fd.append("uploadedBy", input.uploadedBy);
    fd.append("file", new Blob([new Uint8Array(input.fileBuffer)], { type: input.mimeType }), input.fileName);

    const res = await fetch(`${this.approvalServiceUrl}/internal/files/upload`, {
      method: "POST",
      headers: { "X-Internal-Token": this.internalToken },
      body: fd,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[approval-client] attach receipt failed ${res.status}: ${txt.slice(0, 200)}`);
      return null;
    }
    return (await res.json()) as { id: string };
  }

  /**
   * 결재 문서 상신 취소 (SUBMITTED → DRAFT 전이).
   * approval-service `/internal/documents/:id/withdraw` 호출.
   */
  async withdrawDocument(documentId: string, requesterId: string): Promise<void> {
    const res = await fetch(`${this.approvalServiceUrl}/internal/documents/${documentId}/withdraw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": this.internalToken,
      },
      body: JSON.stringify({ requesterId }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`approval withdraw ${res.status}: ${txt.slice(0, 300)}`);
    }
  }
}
