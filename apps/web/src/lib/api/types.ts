// API 응답 엔티티 타입 (프론트가 JSON으로 받는 형태)
//   - DateTime → ISO string
//   - Decimal  → string | number (드라이버 직렬화)
//   - enum     → string (백엔드 enum 값)

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  plannedBudget: string | number | null;
  actualBudget: string | number | null;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  overallProgress: number | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
}

export interface ProjectListItem extends Project {
  ownerName: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
  projects?: { projectId: string; sortOrder: number }[];
}

export interface Dependency {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  dependencyType: string;
  lag: number;
  createdBy: string;
  createdAt: string;
}

export interface SegmentAssignment {
  id: string;
  segmentId: string;
  resourceId: string;
  personUserId: string | null;
  externalPersonId: string | null;
  equipmentResourceId: string | null;
  allocationMode: string;
  allocationPercent: number | null;
  allocationHoursPerDay: number | null;
  createdAt: string;
  updatedAt: string;
  resourceName?: string;
  resourceType?: string;
}

export interface TaskSegment {
  id: string;
  taskId: string;
  name: string;
  sortOrder: number;
  startDate: string;
  endDate: string;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
  assignments?: SegmentAssignment[];
}

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  status: string;
  sortOrder: number;
  overallProgress: number;
  isManualProgress: boolean;
  isMilestone: boolean;
  isCritical: boolean;
  totalFloat: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  segments?: TaskSegment[];
}

export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  mentions?: { userId: string }[];
}

// ─── Attendance ──────────────────────────────────────────────────────────────
// NOTE: 출퇴근 기록/캘린더(getToday·getCalendar·getSummary) 응답은 컴포넌트 로컬
//   타입(AttendanceView의 TodayRecord·CalendarDay)과 필드가 달라 별도 정밀 대조 후 타이핑 예정.

export interface WorkScheduleEntry {
  id: string;
  userId: string;
  date: string;
  entryType: string;
  startTime: string | null;
  endTime: string | null;
  label: string | null;
  groupId: string | null;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Leave / Holiday Work ────────────────────────────────────────────────────
export interface LeaveBalance {
  id: string;
  userId: string;
  year: number;
  totalDays: number;
  longServiceDays: number;
  usedDays: number;
  pendingDays: number;
  adjustedDays: number;
  updatedAt: string;
  remainingDays: number;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  approverId: string | null;
  secondApproverId: string | null;
  thirdApproverId: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string | null;
  approverName?: string | null;
  secondApproverName?: string | null;
  thirdApproverName?: string | null;
}

export interface HolidayWorkRequest {
  id: string;
  userId: string;
  date: string;
  reason: string;
  status: string;
  approverId: string | null;
  secondApproverId: string | null;
  thirdApproverId: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string | null;
  approverName?: string | null;
  secondApproverName?: string | null;
  thirdApproverName?: string | null;
}

// ─── User / Org ──────────────────────────────────────────────────────────────
export interface UserProfile {
  phoneOffice?: string | null;
  phoneMobile?: string | null;
  address?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  status: string;
  retirementDate: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  profile?: UserProfile | null;
  isOnline?: boolean;
  // 일부 응답/caller가 프로필 필드를 평탄하게 접근 (호환용 옵셔널)
  phoneOffice?: string | null;
  phoneMobile?: string | null;
  address?: string | null;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  headUserId: string | null;
  soukwalUserId: string | null;
  daepyoUserId: string | null;
  level: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // getTree/getById 계산·관계 필드
  memberCount?: number;
  headName?: string | null;
  soukwalName?: string | null;
  daepyoName?: string | null;
  children?: Department[];
  members?: {
    userId: string;
    departmentName?: string | null;
    user?: { id: string; name: string; email: string; role: string };
  }[];
}

export interface ApprovalLine {
  id: string;
  userId: string;
  approverId: string;
  secondApproverId: string | null;
  thirdApproverId: string | null;
  delegateId: string | null;
  delegateUntil: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // 백엔드 보강 필드 (이름 lookup / 위임 상태)
  approverName?: string | null;
  secondApproverName?: string | null;
  thirdApproverName?: string | null;
  delegateName?: string | null;
  isDelegated?: boolean;
}

// ─── Notification / ActivityLog / Dashboard ──────────────────────────────────
export interface Notification {
  id: string;
  userId: string;
  type: string;
  source: string;
  title: string;
  body: string;
  isRead: boolean;
  priority: number;
  linkUrl: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  projectId: string | null;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: unknown;
  createdAt: string;
  project?: { id: string; name: string } | null;
}

export interface DashboardConfig {
  defaultGroupBy?: string;
  pinnedProjectIds?: string[];
  issueFilter?: string;
  presentationMode?: boolean;
}

// ─── Board / WorkLog / Calendar (collab) ─────────────────────────────────────
export interface BoardCategory {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
  boards?: Board[];
}

export interface Board {
  id: string;
  categoryId: string;
  code: string;
  name: string;
  description: string | null;
  writeRoles: string[];
  readAudience: string;
  audienceTargetId: string | null;
  allowComments: boolean;
  allowAttachments: boolean;
  postPinnable: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: BoardCategory;
}

export interface BoardComment {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  content: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  authorName?: string | null;
  replies?: BoardComment[];
}

export interface BoardPost {
  id: string;
  boardId: string;
  authorId: string;
  publishingDepartmentId: string | null;
  publishingDepartmentName: string | null;
  targetDepartmentId: string | null;
  targetDepartmentName: string | null;
  title: string;
  content: string;
  isPinned: boolean;
  priority: number;
  publishedAt: string;
  expiresAt: string | null;
  isDeleted: boolean;
  viewCount: number;
  requestStatus: string | null;
  requestType: string | null;
  assigneeId: string | null;
  moduleArea: string | null;
  releaseVersion: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // 목록/상세 보강 필드
  authorName?: string | null;
  assigneeName?: string | null;
  boardCode?: string;
  boardName?: string;
  categoryCode?: string;
  isRead?: boolean;
  commentCount?: number;
  attachments?: unknown[];
  comments?: BoardComment[];
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface WorkLog {
  id: string;
  taskId: string;
  segmentId: string | null;
  authorId: string;
  authorName: string;
  content: string;
  workedAt: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  segmentName?: string | null;
}

export interface CalendarEntry {
  id: string;
  type: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  color: string | null;
  recurrence: string | null;
  targetDepartmentId: string | null;
  startTime: string | null;
  endTime: string | null;
  source: string;
  externalId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// 게시글 목록/피드 뷰 DTO (post.service가 가공해 반환 — raw Post와 다름)
export interface BoardPostListItem {
  id: string;
  title: string;
  summary: string;
  isPinned: boolean;
  priority: number;
  publishedAt: string;
  viewCount: number;
  commentCount: number;
  attachmentCount: number;
  isRead: boolean;
  author: { id: string; name: string };
  publishingDepartment: { id: string; name: string } | null;
  board: { code: string; name: string };
  requestStatus?: string | null;
  requestType?: string | null;
  boardCode?: string;
}

// 게시글 피드 뷰 DTO (getFeed — 평탄 board/author 필드)
export interface BoardFeedItem {
  id: string;
  title: string;
  summary: string;
  isPinned: boolean;
  priority: number;
  publishedAt: string;
  isRead: boolean;
  boardCode: string;
  boardName: string;
  authorName: string;
}

// ─── Expense (services/expense) ──────────────────────────────────────────────
export interface ExpenseSource {
  id: string;
  userId: string;
  name: string;
  displayName: string | null;
  type: string;
  cardNumber: string | null;
  ownership: string;
  active: boolean;
  createdAt: string;
}

export interface ExpenseTransaction {
  id: string;
  userId: string;
  statementId: string | null;
  sourceId: string;
  isManual: boolean;
  transactedAt: string;
  merchantName: string;
  amount: string | number;
  currency: string;
  foreignAmount: string | number | null;
  paymentType: string | null;
  installmentMonths: number | null;
  approvalNo: string | null;
  contractId: string | null;
  contractNumber: string | null;
  contractName: string | null;
  detail: string | null;
  memo: string | null;
  status: string;
  isCanceled: boolean;
  createdAt: string;
  updatedAt: string;
  matches?: ExpenseMatch[];
  settlementItems?: { settlementId: string; settlement?: { id: string; title: string; status: string } }[];
  source?: ExpenseSource | { id: string; name: string; displayName?: string | null; type?: string; ownership?: string };
}

export interface ExpenseStatement {
  id: string;
  userId: string;
  sourceId: string;
  originalFileName: string;
  fileUrl: string;
  parserVersion: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalRows: number;
  parsedRows: number;
  errorRows: number;
  parsedAt: string;
}

export interface ExpenseReceipt {
  id: string;
  userId: string;
  fileUrl: string;
  storageKey: string;
  originalFileName: string;
  fileType: string;
  fileSize: number;
  ocrStatus: string;
  ocrEngineUsed: string | null;
  ocrRawJson?: unknown;
  ocrText: string | null;
  extractedAmount: string | number | null;
  extractedMerchant: string | null;
  extractedDate: string | null;
  uploadedAt: string;
  ocrCompletedAt: string | null;
  matches?: ExpenseMatch[];
}

export interface ExpenseMatch {
  id: string;
  transactionId: string;
  receiptId: string;
  source: string;
  confidence: number | null;
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  createdAt: string;
  transaction?: Partial<ExpenseTransaction>;
  receipt?: Partial<ExpenseReceipt>;
}

export interface ExpenseSettlement {
  id: string;
  userId: string;
  periodStart: string | null;
  periodEnd: string | null;
  title: string;
  status: string;
  exportedFileUrl: string | null;
  exportedAt: string | null;
  approvalDocumentId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  receivedAt: string | null;
  receivedById: string | null;
  paidAt: string | null;
  paidById: string | null;
  paidAmount: string | number | null;
  paidNote: string | null;
  totalCount: number | null;
  totalAmount: string | number | null;
  categoryStats?: unknown;
  categoryCode: string | null;
  createdAt: string;
  updatedAt: string;
  items?: unknown[];
}

// ─── Approval (services/approval) ────────────────────────────────────────────
export interface ApprovalTemplate {
  id: string;
  code: string;
  name: string;
  category: string;
  description: string | null;
  fields: unknown;
  itemsTableConfig?: unknown;
  defaultBody: string | null;
  footer: string | null;
  defaultApprovalLineRule: string;
  postApprovalAction: string | null;
  relatedService: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalStep {
  id: string;
  documentId: string;
  stepOrder: number;
  roleName: string;
  approverId: string;
  approverName: string;
  status: string;
  comment: string | null;
  actedAt: string | null;
  createdAt: string;
}

export interface ApprovalAttachment {
  id: string;
  documentId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  fileName: string;
  storagePath: string;
  fileSize: number;
  mimeType: string;
  isScanned: boolean;
  uploadedBy: string;
  createdAt: string;
}

export interface ApprovalDocument {
  id: string;
  documentNumber: string;
  templateId: string;
  title: string;
  requestedBy: string;
  requesterName: string | null;
  department: string;
  approvalStepCount: number;
  status: string;
  content?: unknown;
  richBody: string | null;
  itemsData?: unknown[];
  itemsTotal: string | number | null;
  amount: string | number | null;
  referenceType: string | null;
  referenceId: string | null;
  ccUsers: string[];
  agreementUsers: string[];
  referenceDepts: string[];
  referencePersons: string[];
  notes: string | null;
  templateFooter: string | null;
  pdfGeneratedAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  forwardedAt: string | null;
  createdAt: string;
  updatedAt: string;
  steps?: ApprovalStep[];
  attachments?: ApprovalAttachment[];
  template?: ApprovalTemplate | { code: string; name: string };
  // getById 보강 + legacy 폼 별칭(caller가 richBody||body 식으로 방어적 접근)
  allowedTransitions?: string[];
  body?: string;
  fields?: unknown;
  items?: unknown[];
}

// ─── Equipment (services/equipment) ──────────────────────────────────────────
export interface EquipmentCategory2 {
  id: string;
  name: string;
  type: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Equipment {
  id: string;
  categoryId: string;
  name: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  acquiredAt: string | null;
  status: string;
  description: string | null;
  imageUrl: string | null;
  metadata?: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // get 보강(관계)
  category?: EquipmentCategory2 | { id: string; name: string };
  components?: unknown[];
  sensors?: Sensor[];
  deployments?: unknown[];
}

export interface Sensor {
  id: string;
  categoryId: string;
  name: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  acquiredAt: string | null;
  status: string;
  description: string | null;
  calibrationIntervalDays: number | null;
  lastCalibratedAt: string | null;
  nextCalibrationDue: string | null;
  currentLocation: string | null;
  currentEquipmentId: string | null;
  currentDeploymentId: string | null;
  metadata?: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  category?: EquipmentCategory2 | { id: string; name: string };
}

export interface Supplier {
  id: string;
  name: string;
  country: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  businessNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: unknown[];
}

// ─── Equipment: Inventory cluster ────────────────────────────────────────────
export interface InventoryItem {
  id: string;
  inventoryNo: string;
  itemName: string | null;
  manufacturer: string | null;
  productMasterId: string | null;
  variantId: string | null;
  serialNumber: string | null;
  trackingMode: string;
  quantity: number;
  category: string;
  currentLocation: string | null;
  currentStatus: string;
  unitPrice: string | number | null;
  supplyAmount: string | number | null;
  totalAmount: string | number | null;
  totalAdditionalCost: string | number;
  totalCostOfOwnership: string | number;
  projectName: string | null;
  assigneeName: string | null;
  sourceType: string | null;
  sourceId: string | null;
  orderItemId: string | null;
  costSettlementId: string | null;
  supplierId: string | null;
  inboundRequestId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // list/get 보강(관계)
  productMaster?: { id?: string; name: string; itemType?: string } | null;
  variant?: ProductVariant | null;
  locations?: { locationId: string; quantity: number; location?: { id: string; name: string } }[];
}

export interface StorageLocation {
  id: string;
  name: string;
  type: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  inventoryItemId: string;
  type: string;
  date: string;
  sequenceNo: string | null;
  quantity: number;
  fromLocation: string | null;
  toLocation: string | null;
  deliveryTo: string | null;
  supplier: string | null;
  projectName: string | null;
  assigneeName: string | null;
  costNumber: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AssetCostEvent {
  id: string;
  inventoryItemId: string;
  type: string;
  title: string;
  description: string | null;
  vendor: string | null;
  cost: string | number;
  currency: string | null;
  foreignAmount: string | number | null;
  exchangeRate: string | number | null;
  eventDate: string;
  performedBy: string | null;
  relatedOrderId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productMasterId: string;
  skuCode: string | null;
  variantSpecs: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InboundRequest {
  id: string;
  code: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
  sourceDocNumber: string | null;
  requesterId: string;
  requestedAt: string;
  notes: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  items?: unknown[];
}

export interface BundleShipment {
  id: string;
  code: string;
  parentMasterId: string | null;
  customerId: string;
  projectId: string | null;
  shippedAt: string;
  shipTo: string | null;
  warrantyUntil: string | null;
  totalPrice: string | number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items?: unknown[];
}

// ─── Equipment: Procurement ──────────────────────────────────────────────────
export interface ProductMaster {
  id: string;
  name: string;
  manufacturer: string;
  masterCode: string | null;
  keyAttributes?: unknown;
  unitOfMeasure: string | null;
  defaultCurrency: string | null;
  referencePrice: string | number | null;
  specs?: unknown;
  itemType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  name: string;
  client: string;
  clientContact: string | null;
  manufacturer: string | null;
  category: string;
  contractType: string;
  contractDate: string | null;
  deadline: string | null;
  manager: string | null;
  status: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderInvoice {
  id: string;
  orderId: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: string | number;
  initialAmount: string | number;
  currency: string;
  amountKRW: string | number | null;
  dueDate: string | null;
  paymentTerms: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderPayment {
  id: string;
  orderId: string;
  paymentDate: string | null;
  amount: string | number;
  currency: string;
  amountKRW: string | number | null;
  exchangeRate: string | number | null;
  paymentMethod: string | null;
  bankReference: string | null;
  notes: string | null;
  status: string;
  rejectReason: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderCustomsTax {
  id: string;
  orderId: string;
  status: string;
  customsDuty: string | number | null;
  vat: string | number | null;
  totalAmount: string | number | null;
  startedAt: string;
  startedBy: string | null;
  paidAt: string | null;
  paidBy: string | null;
  paidByName: string | null;
  notes: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OverseasOrderItem {
  id: string;
  orderId: string;
  productMasterId: string | null;
  variantId: string | null;
  name: string;
  spec: string | null;
  quantity: number;
  receivedQuantity: number;
  unitPrice: string | number;
  amount: string | number;
  receiptStatus: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  inventoryItems?: { id: string; inventoryNo: string }[];
}

export interface OverseasOrder {
  id: string;
  contractId: string;
  orderNumber: string;
  manufacturer: string;
  currency: string;
  orderType: string;
  status: string;
  orderDate: string | null;
  approvedAt: string | null;
  estimatedProductionEnd: string | null;
  estimatedShipDate: string | null;
  actualShipDate: string | null;
  customsDate: string | null;
  arrivalDate: string | null;
  productionProgress: number;
  productionNotes: string | null;
  arrivalLocation: string | null;
  orderedBy: string;
  customsHandler: string | null;
  invoiceNo: string | null;
  paymentTerms: string | null;
  customer: string | null;
  approverId: string | null;
  approverName: string | null;
  secondApproverId: string | null;
  secondApproverName: string | null;
  thirdApproverId: string | null;
  thirdApproverName: string | null;
  totalAmount: string | number;
  totalAmountKRW: string | number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items?: OverseasOrderItem[];
  invoice?: OrderInvoice | null;
  customsTax?: OrderCustomsTax | null;
  payments?: OrderPayment[];
  contract?: Contract;
}
