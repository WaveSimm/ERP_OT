"use client";

import { request } from "./client";
import type {
  Paginated, Equipment, Sensor, EquipmentCategory2, Supplier,
  InventoryItem, StorageLocation, InventoryTransaction, AssetCostEvent,
  ProductVariant, InboundRequest, BundleShipment,
} from "./types";


// ─── Equipment (장비 관리) ────────────────────────────────────────────────────

export const equipmentApi = {
  list: (params?: { categoryId?: string; status?: string; search?: string; page?: number; limit?: number }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<Paginated<Equipment>>(
      `/equipment${q ? `?${q}` : ""}`,
    );
  },
  get: (id: string) => request<Equipment>(`/equipment/${id}`),
  create: (data: unknown) =>
    request<Equipment>("/equipment", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<Equipment>(`/equipment/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  changeStatus: (id: string, status: string) =>
    request<Equipment>(`/equipment/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (id: string) => request<void>(`/equipment/${id}`, { method: "DELETE" }),
  getMaintenance: (id: string, page = 1) =>
    request<any>(`/maintenance/equipment/${id}?page=${page}`),
  getSchedules: (id: string, startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    return request<any[]>(`/schedules/equipment/${id}${q.toString() ? `?${q}` : ""}`);
  },
  getCompatibleSensors: (id: string) =>
    request<any[]>(`/compatibility/equipment/${id}`),
  getDeployments: (id: string) =>
    request<any>(`/deployments?equipmentId=${id}`),
  // 구성요소
  getComponents: (id: string) => request<any[]>(`/equipment/${id}/components`),
  addComponent: (id: string, data: { name: string; spec?: string; notes?: string }) =>
    request<any>(`/equipment/${id}/components`, { method: "POST", body: JSON.stringify(data) }),
  updateComponent: (compId: string, data: { name?: string; spec?: string; notes?: string }) =>
    request<any>(`/equipment/components/${compId}`, { method: "PUT", body: JSON.stringify(data) }),
  removeComponent: (compId: string) =>
    request<void>(`/equipment/components/${compId}`, { method: "DELETE" }),
};

export const sensorApi = {
  list: (params?: { categoryId?: string; status?: string; search?: string; page?: number; limit?: number }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<Paginated<Sensor>>(
      `/sensors${q ? `?${q}` : ""}`,
    );
  },
  listAvailable: (categoryId?: string, startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (categoryId) q.set("categoryId", categoryId);
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    const qs = q.toString();
    return request<Sensor[]>(`/sensors/available${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<Sensor>(`/sensors/${id}`),
  create: (data: unknown) =>
    request<Sensor>("/sensors", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<Sensor>(`/sensors/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  changeStatus: (id: string, status: string) =>
    request<Sensor>(`/sensors/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (id: string) => request<void>(`/sensors/${id}`, { method: "DELETE" }),
  getDeploymentHistory: (id: string) => request<any[]>(`/sensors/${id}/deployment-history`),
  getCompatibleEquipment: (id: string) =>
    request<any[]>(`/compatibility/sensor/${id}`),
  getDeployments: (id: string) =>
    request<any>(`/deployments?sensorId=${id}`),
  getMaintenance: (id: string, page = 1) =>
    request<any>(`/sensors/${id}/maintenance?page=${page}`),
  getSchedules: (id: string, startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    return request<any[]>(`/schedules/sensor/${id}${q.toString() ? `?${q}` : ""}`);
  },
};

export const equipmentCategoryApi = {
  list: (type?: string) =>
    request<EquipmentCategory2[]>(`/categories${type ? `?type=${type}` : ""}`),
  create: (data: { name: string; type: string; description?: string; sortOrder?: number }) =>
    request<EquipmentCategory2>("/categories", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<EquipmentCategory2>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/categories/${id}`, { method: "DELETE" }),
};

export const maintenanceApi = {
  create: (data: unknown) =>
    request<any>("/maintenance", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<any>(`/maintenance/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/maintenance/${id}`, { method: "DELETE" }),
};

export const equipmentScheduleApi = {
  getTimeline: (params: { startDate: string; endDate: string; assetType?: string; categoryId?: string }) => {
    const q = new URLSearchParams();
    q.set("startDate", params.startDate);
    q.set("endDate", params.endDate);
    if (params.assetType) q.set("assetType", params.assetType);
    if (params.categoryId) q.set("categoryId", params.categoryId);
    return request<any>(`/schedules/timeline?${q}`);
  },
  create: (data: unknown) =>
    request<any>("/schedules", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<any>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/schedules/${id}`, { method: "DELETE" }),
};

export const deploymentApi = {
  list: (params?: { projectId?: string; equipmentId?: string; sensorId?: string; status?: string }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<any>(`/deployments${q ? `?${q}` : ""}`);
  },
  listByTask: (taskId: string) => request<any[]>(`/deployments/by-task/${taskId}`),
  get: (id: string) => request<any>(`/deployments/${id}`),
  create: (data: unknown) =>
    request<any>("/deployments", { method: "POST", body: JSON.stringify(data) }),
  activate: (id: string) =>
    request<any>(`/deployments/${id}/activate`, { method: "POST", body: "{}" }),
  complete: (id: string) =>
    request<any>(`/deployments/${id}/complete`, { method: "POST", body: "{}" }),
  cancel: (id: string) =>
    request<any>(`/deployments/${id}/cancel`, { method: "POST", body: "{}" }),
  remove: (id: string) =>
    request<void>(`/deployments/${id}`, { method: "DELETE" }),
};

export const equipmentStatsApi = {
  summary: () => request<any>("/stats/summary"),
  utilization: (startDate: string, endDate: string) =>
    request<any[]>(`/stats/utilization?startDate=${startDate}&endDate=${endDate}`),
  maintenanceCosts: (startDate?: string, endDate?: string) => {
    const q = new URLSearchParams();
    if (startDate) q.set("startDate", startDate);
    if (endDate) q.set("endDate", endDate);
    return request<any[]>(`/stats/maintenance-costs${q.toString() ? `?${q}` : ""}`);
  },
  breakdownFrequency: (limit = 10) =>
    request<any[]>(`/stats/breakdown-frequency?limit=${limit}`),
  calibrationWarnings: () => request<any[]>("/stats/calibration-warnings"),
  preventiveDue: (days = 30) => request<any[]>(`/stats/preventive-due?days=${days}`),
};

export const deploymentTemplateApi = {
  list: (params?: { categoryId?: string }) => {
    const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
    return request<any[]>(`/deployment-templates${q ? `?${q}` : ""}`);
  },
  get: (id: string) => request<any>(`/deployment-templates/${id}`),
  create: (data: { name: string; description?: string; categoryId?: string; sensorConfig: unknown; isPublic?: boolean }) =>
    request<any>("/deployment-templates", { method: "POST", body: JSON.stringify(data) }),
  saveFromDeployment: (deploymentId: string, data: { name: string; description?: string; isPublic?: boolean }) =>
    request<any>(`/deployment-templates/from-deployment/${deploymentId}`, { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/deployment-templates/${id}`, { method: "DELETE" }),
};

export const compatibilityApi = {
  create: (data: { equipmentId: string; sensorId: string; notes?: string }) =>
    request<any>("/compatibility", { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) => request<void>(`/compatibility/${id}`, { method: "DELETE" }),
};

// ─── Repair/AS Management API ────────────────────────────────────────────

export const repairApi = {
  // 고객
  getCustomers: (params?: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any>(`/customers${qs ? `?${qs}` : ""}`);
  },
  createCustomer: (data: unknown) =>
    request<any>("/customers", { method: "POST", body: JSON.stringify(data) }),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  updateCustomer: (id: string, data: unknown) =>
    request<any>(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCustomer: (id: string) =>
    request<void>(`/customers/${id}`, { method: "DELETE" }),

  // 고객 담당자
  getContacts: (customerId: string) =>
    request<any[]>(`/customers/${customerId}/contacts`),
  createContact: (customerId: string, data: unknown) =>
    request<any>(`/customers/${customerId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
  updateContact: (contactId: string, data: unknown) =>
    request<any>(`/customers/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContact: (contactId: string) =>
    request<void>(`/customers/contacts/${contactId}`, { method: "DELETE" }),

  // 고객 자산
  getCustomerAssets: (params?: { customerId?: string; search?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<any>(`/customer-assets${qs ? `?${qs}` : ""}`);
  },
  getCustomerAsset: (id: string) => request<any>(`/customer-assets/${id}`),
  createCustomerAsset: (data: unknown) =>
    request<any>("/customer-assets", { method: "POST", body: JSON.stringify(data) }),
  updateCustomerAsset: (id: string, data: unknown) =>
    request<any>(`/customer-assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCustomerAsset: (id: string) =>
    request<void>(`/customer-assets/${id}`, { method: "DELETE" }),

  // 수리 접수
  getRepairOrders: (params?: { status?: string; statusGroup?: string; customerId?: string; search?: string; otInventoryNo?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.statusGroup) q.set("statusGroup", params.statusGroup);
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.search) q.set("search", params.search);
    if (params?.otInventoryNo) q.set("otInventoryNo", params.otInventoryNo);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any>(`/repair-orders${qs ? `?${qs}` : ""}`);
  },
  createRepairOrder: (data: unknown) =>
    request<any>("/repair-orders", { method: "POST", body: JSON.stringify(data) }),
  getRepairOrder: (id: string) => request<any>(`/repair-orders/${id}`),
  updateRepairOrder: (id: string, data: unknown) =>
    request<any>(`/repair-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeStatus: (id: string, data: { status: string }) =>
    request<any>(`/repair-orders/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairOrder: (id: string) =>
    request<void>(`/repair-orders/${id}`, { method: "DELETE" }),
  restoreRepairOrder: (id: string) =>
    request<any>(`/repair-orders/${id}/restore`, { method: "POST" }),
  getTransitions: (id: string) => request<any>(`/repair-orders/${id}/transitions`),

  // 점검보고서
  getInspectionReport: (repairOrderId: string) =>
    request<any>(`/inspection-reports?repairOrderId=${repairOrderId}`),
  createInspectionReport: (data: unknown) =>
    request<any>("/inspection-reports", { method: "POST", body: JSON.stringify(data) }),
  updateInspectionReport: (id: string, data: unknown) =>
    request<any>(`/inspection-reports/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // 비용
  getRepairCosts: (repairOrderId: string) =>
    request<any>(`/repair-costs?repairOrderId=${repairOrderId}`),
  createRepairCost: (data: unknown) =>
    request<any>("/repair-costs", { method: "POST", body: JSON.stringify(data) }),
  updateRepairCost: (id: string, data: unknown) =>
    request<any>(`/repair-costs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairCost: (id: string) =>
    request<void>(`/repair-costs/${id}`, { method: "DELETE" }),

  // 견적
  getRepairQuotes: (repairOrderId: string) =>
    request<any>(`/repair-quotes?repairOrderId=${repairOrderId}`),
  createRepairQuote: (data: unknown) =>
    request<any>("/repair-quotes", { method: "POST", body: JSON.stringify(data) }),
  updateRepairQuote: (id: string, data: unknown) =>
    request<any>(`/repair-quotes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeQuoteStatus: (id: string, data: { status: string }) =>
    request<any>(`/repair-quotes/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteRepairQuote: (id: string) =>
    request<void>(`/repair-quotes/${id}`, { method: "DELETE" }),
  addQuoteItem: (quoteId: string, data: unknown) =>
    request<any>(`/repair-quotes/${quoteId}/items`, { method: "POST", body: JSON.stringify(data) }),
  deleteQuoteItem: (itemId: string) =>
    request<void>(`/repair-quotes/items/${itemId}`, { method: "DELETE" }),

  // 부품
  getParts: (params?: { search?: string; lowStock?: boolean; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.lowStock) q.set("lowStock", "true");
    if (params?.page) q.set("page", String(params.page));
    const qs = q.toString();
    return request<any>(`/parts${qs ? `?${qs}` : ""}`);
  },
  getPart: (id: string) => request<any>(`/parts/${id}`),
  createPart: (data: unknown) =>
    request<any>("/parts", { method: "POST", body: JSON.stringify(data) }),
  updatePart: (id: string, data: unknown) =>
    request<any>(`/parts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deletePart: (id: string) =>
    request<void>(`/parts/${id}`, { method: "DELETE" }),

  // 부품 입출고
  getPartTransactions: (params?: { partId?: string; repairOrderId?: string }) => {
    const q = new URLSearchParams();
    if (params?.partId) q.set("partId", params.partId);
    if (params?.repairOrderId) q.set("repairOrderId", params.repairOrderId);
    const qs = q.toString();
    return request<any>(`/part-transactions${qs ? `?${qs}` : ""}`);
  },
  createPartTransaction: (data: unknown) =>
    request<any>("/part-transactions", { method: "POST", body: JSON.stringify(data) }),

  // 발주
  getPurchaseOrders: (params?: { status?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    const qs = q.toString();
    return request<any>(`/purchase-orders${qs ? `?${qs}` : ""}`);
  },
  createPurchaseOrder: (data: unknown) =>
    request<any>("/purchase-orders", { method: "POST", body: JSON.stringify(data) }),
  updatePurchaseOrder: (id: string, data: unknown) =>
    request<any>(`/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  receivePurchaseOrder: (id: string, data: { items: { itemId: string; receivedQuantity: number }[] }) =>
    request<any>(`/purchase-orders/${id}/receive`, { method: "PATCH", body: JSON.stringify(data) }),

  // 발송/입고
  getShipments: (repairOrderId: string) =>
    request<any>(`/shipments?repairOrderId=${repairOrderId}`),
  createShipment: (data: unknown) =>
    request<any>("/shipments", { method: "POST", body: JSON.stringify(data) }),
  updateShipment: (id: string, data: unknown) =>
    request<any>(`/shipments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  changeShipmentStatus: (id: string, data: { status: string }) =>
    request<any>(`/shipments/${id}/status`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteShipment: (id: string) =>
    request<void>(`/shipments/${id}`, { method: "DELETE" }),

  // 통계
  getRepairStatsSummary: () => request<any>("/repair-stats/summary"),
  getRepairStatsByEquipment: () => request<any>("/repair-stats/by-equipment"),
  getRepairStatsMonthly: (months?: number) =>
    request<any>(`/repair-stats/monthly${months ? `?months=${months}` : ""}`),
  getRepairStatsCosts: () => request<any>("/repair-stats/costs"),
  getRepairStatsPartsUsage: () => request<any>("/repair-stats/parts-usage"),
  getRepairStatsYearly: () => request<any>("/repair-stats/yearly"),
  getRepairStatsByCustomer: () => request<any>("/repair-stats/by-customer"),
  getRepairStatsByHandler: () => request<any>("/repair-stats/by-handler"),
};

// ─── Supplier (제조사/공급사) API ────────────────────────────────────────────

export const supplierApi = {
  list: (params?: { search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<Paginated<Supplier>>(`/suppliers${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<Supplier>(`/suppliers/${id}`),
  findByName: (name: string) => request<Supplier | null>(`/suppliers/by-name?name=${encodeURIComponent(name)}`),
  create: (data: unknown) =>
    request<Supplier>("/suppliers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<Supplier>(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/suppliers/${id}`, { method: "DELETE" }),
  addContact: (supplierId: string, data: unknown) =>
    request<any>(`/suppliers/${supplierId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
  updateContact: (contactId: string, data: unknown) =>
    request<any>(`/suppliers/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContact: (contactId: string) =>
    request<void>(`/suppliers/contacts/${contactId}`, { method: "DELETE" }),
};

// ─── Procurement (구매/재고) API ─────────────────────────────────────────────

export const procurementApi = {
  // 장비 마스터
  //   v1.6 B안 (2026-05-13): itemType 필터 (SIMPLE/BUNDLE) + includeBundle
  //   기본은 SIMPLE만 (발주 등 검색에서 번들 차단)
  getProducts: (params?: {
    search?: string;
    name?: string;
    manufacturer?: string;
    itemType?: "SIMPLE" | "BUNDLE";
    includeBundle?: boolean;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.name) q.set("name", params.name);
    if (params?.manufacturer) q.set("manufacturer", params.manufacturer);
    if (params?.itemType) q.set("itemType", params.itemType);
    if (params?.includeBundle) q.set("includeBundle", "true");
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any>(`/procurement/products${qs ? `?${qs}` : ""}`);
  },
  getProduct: (id: string) => request<any>(`/procurement/products/${id}`),
  createProduct: (data: unknown) =>
    request<any>("/procurement/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id: string, data: unknown) =>
    request<any>(`/procurement/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProduct: (id: string) =>
    request<void>(`/procurement/products/${id}`, { method: "DELETE" }),
  getManufacturers: () => request<string[]>("/procurement/products/manufacturers"),

  // v1.6 B안: 번들 구성품 (BomItem) 관리
  getBundleItems: (parentMasterId: string) =>
    request<any[]>(`/procurement/products/${parentMasterId}/bundle-items`),
  replaceBundleItems: (parentMasterId: string, items: unknown[]) =>
    request<any>(`/procurement/products/${parentMasterId}/bundle-items`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  // v1.6 B안 (사전 조립): 구성품 차감 + 번들 입고 단일 트랜잭션
  assembleBundle: (parentMasterId: string, data: {
    components: Array<{ inventoryItemId: string; locationId?: string; quantity: number }>;
    output: { quantity?: number; unitPrice?: number; locationId?: string; serialNumber?: string; notes?: string };
  }) => request<any>(`/procurement/products/${parentMasterId}/assemble`, {
    method: "POST",
    body: JSON.stringify(data),
  }),

  // 계약
  getContracts: (params?: { search?: string; status?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any>(`/procurement/contracts${qs ? `?${qs}` : ""}`);
  },
  getContract: (id: string) => request<any>(`/procurement/contracts/${id}`),
  createContract: (data: unknown) =>
    request<any>("/procurement/contracts", { method: "POST", body: JSON.stringify(data) }),
  updateContract: (id: string, data: unknown) =>
    request<any>(`/procurement/contracts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteContract: (id: string) =>
    request<void>(`/procurement/contracts/${id}`, { method: "DELETE" }),
  // v1.6.1 (2026-05-15): 계약 확정 — PROSPECTIVE → ACTIVE
  finalizeContract: (id: string, data: { contractNumber: string; contractDate?: string }) =>
    request<any>(`/procurement/contracts/${id}/finalize`, { method: "POST", body: JSON.stringify(data) }),

  // 해외 발주
  getOrders: (params?: { search?: string; status?: string; currency?: string; orderType?: string; contractId?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc"; hasPayment?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.currency) q.set("currency", params.currency);
    if (params?.orderType) q.set("orderType", params.orderType);
    if (params?.contractId) q.set("contractId", params.contractId);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    if (params?.hasPayment) q.set("hasPayment", "true");
    const qs = q.toString();
    return request<any>(`/procurement/orders${qs ? `?${qs}` : ""}`);
  },
  getOrder: (id: string) => request<any>(`/procurement/orders/${id}`),
  createOrder: (data: unknown) =>
    request<any>("/procurement/orders", { method: "POST", body: JSON.stringify(data) }),
  updateOrder: (id: string, data: unknown) =>
    request<any>(`/procurement/orders/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrder: (id: string) =>
    request<void>(`/procurement/orders/${id}`, { method: "DELETE" }),
  transitionOrder: (id: string, status: string, transitionDate?: string) =>
    request<any>(`/procurement/orders/${id}/transition`, {
      method: "POST",
      body: JSON.stringify(transitionDate ? { status, transitionDate } : { status }),
    }),
  // v1.6 (2026-05-14): 결재 상신 취소
  cancelOrderSubmission: (id: string) =>
    request<any>(`/procurement/orders/${id}/cancel-submission`, { method: "POST" }),
  getDashboard: () => request<any>("/procurement/orders/dashboard"),

  // 발주 품목
  addOrderItem: (orderId: string, data: unknown) =>
    request<any>(`/procurement/orders/${orderId}/items`, { method: "POST", body: JSON.stringify(data) }),
  updateOrderItem: (itemId: string, data: unknown) =>
    request<any>(`/procurement/orders/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrderItem: (itemId: string) =>
    request<void>(`/procurement/orders/items/${itemId}`, { method: "DELETE" }),

  // 부분 입고
  receiveItems: (orderId: string, receipts: Array<{ itemId: string; quantity: number }>) =>
    request<any>(`/procurement/orders/${orderId}/receive`, { method: "POST", body: JSON.stringify({ receipts }) }),

  // 재고 연결
  linkInventory: (itemId: string, inventoryNo: string) =>
    request<any>(`/procurement/orders/items/${itemId}/link-inventory`, { method: "POST", body: JSON.stringify({ inventoryNo }) }),
  unlinkInventory: (itemId: string, inventoryId: string) =>
    request<any>(`/procurement/orders/items/${itemId}/inventory/${inventoryId}`, { method: "DELETE" }),

  // v1.6 회계정산 (2026-05-14)
  getSettlement: (orderId: string) =>
    request<any>(`/procurement/orders/${orderId}/settlement`),
  getInvoice: (orderId: string) =>
    request<any>(`/procurement/orders/${orderId}/invoice`),
  createInvoice: (orderId: string, data: unknown) =>
    request<any>(`/procurement/orders/${orderId}/invoice`, { method: "POST", body: JSON.stringify(data) }),
  updateInvoice: (orderId: string, data: unknown) =>
    request<any>(`/procurement/orders/${orderId}/invoice`, { method: "PATCH", body: JSON.stringify(data) }),
  listPayments: (orderId: string) =>
    request<any>(`/procurement/orders/${orderId}/payments`),
  createPayment: (orderId: string, data: unknown) =>
    request<any>(`/procurement/orders/${orderId}/payments`, { method: "POST", body: JSON.stringify(data) }),
  updatePayment: (paymentId: string, data: unknown) =>
    request<any>(`/procurement/payments/${paymentId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deletePayment: (paymentId: string) =>
    request<void>(`/procurement/payments/${paymentId}`, { method: "DELETE" }),
  // v1.6 (2026-05-14): 송금 요청 워크플로우
  requestPayment: (orderId: string, data: unknown) =>
    request<any>(`/procurement/orders/${orderId}/payment-requests`, { method: "POST", body: JSON.stringify(data) }),
  listPaymentRequests: (status?: "REQUESTED" | "COMPLETED" | "REJECTED") =>
    request<any[]>(`/procurement/payment-requests${status ? `?status=${status}` : ""}`),
  completePaymentRequest: (paymentId: string, data: unknown) =>
    request<any>(`/procurement/payments/${paymentId}/complete`, { method: "PATCH", body: JSON.stringify(data) }),
  rejectPaymentRequest: (paymentId: string, reason: string) =>
    request<any>(`/procurement/payments/${paymentId}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // 진행 이력
  getProgress: (orderId: string) =>
    request<any>(`/procurement/orders/${orderId}/progress`),
  addProgress: (orderId: string, data: { progress: number; note?: string }) =>
    request<any>(`/procurement/orders/${orderId}/progress`, { method: "POST", body: JSON.stringify(data) }),
  deleteProgress: (logId: string) =>
    request<void>(`/procurement/orders/progress/${logId}`, { method: "DELETE" }),

  // v1.6.1 (2026-05-15): 관부가세 처리
  getCustomsTax: (orderId: string) =>
    request<any>(`/procurement/orders/${orderId}/customs-tax`),
  listCustomsTaxes: (status?: "PENDING" | "PAID" | "REJECTED") =>
    request<any[]>(`/procurement/customs-taxes${status ? `?status=${status}` : ""}`),
  correctCustomsTax: (id: string, data: { customsDuty?: number; vat?: number; totalAmount?: number; paidAt?: string; notes?: string }) =>
    request<any>(`/customs-taxes/${id}/correct`, { method: "PATCH", body: JSON.stringify(data) }),
  payCustomsTax: (id: string, data: { customsDuty?: number; vat?: number; totalAmount?: number; paidAt?: string; notes?: string }) =>
    request<any>(`/procurement/customs-taxes/${id}/pay`, { method: "PATCH", body: JSON.stringify(data) }),
  rejectCustomsTax: (id: string, reason: string) =>
    request<any>(`/procurement/customs-taxes/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),
};

// ── Inventory Audit (재고 실사) ──────────────────────────────────────
export const auditApi = {
  list: (params?: { sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any[]>(`/inventory/audits${qs ? `?${qs}` : ""}`);
  },
  getById: (id: string) => request<any>(`/inventory/audits/${id}`),
  create: (data: { name: string; plannedDate: string; notes?: string }) =>
    request<any>("/inventory/audits", { method: "POST", body: JSON.stringify(data) }),
  start: (id: string) =>
    request<any>(`/inventory/audits/${id}/start`, { method: "POST" }),
  pause: (id: string) =>
    request<any>(`/inventory/audits/${id}/pause`, { method: "POST" }),
  resume: (id: string) =>
    request<any>(`/inventory/audits/${id}/resume`, { method: "POST" }),
  cancel: (id: string) =>
    request<any>(`/inventory/audits/${id}/cancel`, { method: "POST" }),
  complete: (id: string) =>
    request<any>(`/inventory/audits/${id}/complete`, { method: "POST" }),
  checkItem: (itemId: string, data: { actualQuantity: number; actualLocation?: string; notes?: string }) =>
    request<any>(`/inventory/audits/items/${itemId}/check`, { method: "POST", body: JSON.stringify(data) }),
  resetItem: (itemId: string) =>
    request<any>(`/inventory/audits/items/${itemId}/reset`, { method: "POST" }),
};

// ── Expense Follow-up (지출결의 후속처리 — procurement) ──────────────────────────────
export const expenseFollowupApi = {
  list: (params?: { status?: string; sortBy?: string; sortOrder?: "asc" | "desc" } | string) => {
    // 기존 호환성: 문자열 status 단일 인자도 받음
    const p = typeof params === "string" ? { status: params } : (params ?? {});
    const q = new URLSearchParams();
    if (p.status) q.set("status", p.status);
    if (p.sortBy) q.set("sortBy", p.sortBy);
    if (p.sortOrder) q.set("sortOrder", p.sortOrder);
    const qs = q.toString();
    return request<any[]>(`/procurement/expenses${qs ? `?${qs}` : ""}`);
  },
  getById: (id: string) => request<any>(`/procurement/expenses/${id}`),
  decide: (id: string, data: { isInventoryTarget: boolean; note?: string; inventoryItems?: number[] }) =>
    request<any>(`/procurement/expenses/${id}/decide`, { method: "POST", body: JSON.stringify(data) }),
  // confirmArrival 폐기 (v1.6, 2026-05-13): 재고 판정 시 자동으로 InboundRequest 큐 생성 → /procurement/inbound에서 receive 처리.
  // 기존 호출처는 모두 제거됨. 410 응답으로 안전망 유지.
  markPayment: (id: string, data: { paidAt: string; paidAmount?: number; paidNote?: string }) =>
    request<any>(`/procurement/expenses/${id}/payment`, { method: "POST", body: JSON.stringify(data) }),
  clearPayment: (id: string) =>
    request<any>(`/procurement/expenses/${id}/payment`, { method: "DELETE" }),
};

// ── Import Cost Settlement (수입원가정산) ────────────────────────────
export const settlementApi = {
  list: (params?: { sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return request<any[]>(`/procurement/settlements${qs ? `?${qs}` : ""}`);
  },
  getById: (id: string) => request<any>(`/procurement/settlements/${id}`),
  create: (data: unknown) =>
    request<any>("/procurement/settlements", { method: "POST", body: JSON.stringify(data) }),
  addExtra: (id: string, data: unknown) =>
    request<any>(`/procurement/settlements/${id}/extras`, { method: "POST", body: JSON.stringify(data) }),
  updateContract: (id: string, contractId: string | null) =>
    request<any>(`/procurement/settlements/${id}/contract`, { method: "PATCH", body: JSON.stringify({ contractId }) }),
  addRemittance: (id: string, data: unknown) =>
    request<any>(`/procurement/settlements/${id}/remittances`, { method: "POST", body: JSON.stringify(data) }),
  removeRemittance: (remittanceId: string) =>
    request<void>(`/procurement/settlements/remittances/${remittanceId}`, { method: "DELETE" }),
  remove: (id: string) =>
    request<void>(`/procurement/settlements/${id}`, { method: "DELETE" }),
};

// ── Inventory (재고) ─────────────────────────────────────────────────────
export const inventoryApi = {
  // 재고 목록
  list: (params?: { category?: string; status?: string; location?: string; search?: string; productMasterId?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set("category", params.category);
    if (params?.status) q.set("status", params.status);
    if (params?.location) q.set("location", params.location);
    if (params?.search) q.set("search", params.search);
    if (params?.productMasterId) q.set("productMasterId", params.productMasterId);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    return request<Paginated<InventoryItem>>(`/inventory/items?${q.toString()}`);
  },
  getFilterOptions: () => request<{ locations: string[]; projects: string[]; assignees: string[] }>("/inventory/items/filter-options"),
  getStats: () => request<any>("/inventory/items/stats"),
  getByNo: (inventoryNo: string) => request<InventoryItem>(`/inventory/items/by-no/${encodeURIComponent(inventoryNo)}`),
  getById: (id: string) => request<InventoryItem>(`/inventory/items/${id}`),
  create: (data: unknown) =>
    request<InventoryItem>("/inventory/items", { method: "POST", body: JSON.stringify(data) }),
  createFromReceipt: (data: { orderItemId: string; serialNumber?: string; currentLocation?: string }) =>
    request<InventoryItem>("/inventory/items/from-receipt", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<InventoryItem>(`/inventory/items/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // 운용 전 한정 — ADMIN만 (2026-05-13)
  delete: (id: string) =>
    request<void>(`/inventory/items/${id}`, { method: "DELETE" }),

  // 입출고 이력
  getTransactions: (itemId: string) => request<InventoryTransaction[]>(`/inventory/transactions/item/${itemId}`),
  getRecentTransactions: (params?: { type?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.limit) q.set("limit", String(params.limit));
    return request<InventoryTransaction[]>(`/inventory/transactions/recent?${q.toString()}`);
  },
  createTransaction: (data: unknown) =>
    request<InventoryTransaction>("/inventory/transactions", { method: "POST", body: JSON.stringify(data) }),

  // 비용이력
  getCostEvents: (itemId: string) => request<AssetCostEvent[]>(`/inventory/costs/item/${itemId}`),
  addCostEvent: (data: unknown) =>
    request<AssetCostEvent>("/inventory/costs", { method: "POST", body: JSON.stringify(data) }),
  deleteCostEvent: (id: string) =>
    request<void>(`/inventory/costs/${id}`, { method: "DELETE" }),

  // 보관위치
  getLocations: (params?: { type?: string; search?: string; includeInactive?: boolean; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.search) q.set("search", params.search);
    if (params?.includeInactive) q.set("includeInactive", "true");
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    return request<{ items: StorageLocation[]; total: number; page: number; limit: number; totalPages: number }>(`/inventory/locations?${q.toString()}`);
  },
  createLocation: (data: unknown) =>
    request<StorageLocation>("/inventory/locations", { method: "POST", body: JSON.stringify(data) }),
  updateLocation: (id: string, data: unknown) =>
    request<StorageLocation>(`/inventory/locations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLocation: (id: string) =>
    request<void>(`/inventory/locations/${id}`, { method: "DELETE" }),
};

// ── v1.6 신규 (2026-05-13): ProductVariant, InboundRequest, BomDefinition, BundleShipment ──

export const productVariantApi = {
  listByMaster: (productMasterId: string, includeInactive?: boolean) => {
    const q = new URLSearchParams({ productMasterId });
    if (includeInactive) q.set("includeInactive", "true");
    return request<ProductVariant[]>(`/product-variants?${q.toString()}`);
  },
  getById: (id: string) => request<ProductVariant>(`/product-variants/${id}`),
  create: (data: { productMasterId: string; skuCode?: string; variantSpecs?: unknown; isActive?: boolean }) =>
    request<ProductVariant>("/product-variants", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<ProductVariant>(`/product-variants/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request<void>(`/product-variants/${id}`, { method: "DELETE" }),
  merge: (idA: string, idB: string) =>
    request<ProductVariant>(`/product-variants/${idA}/merge/${idB}`, { method: "POST" }),
};

export const inboundRequestApi = {
  list: (params?: { status?: string; sourceType?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.sourceType) q.set("sourceType", params.sourceType);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    return request<Paginated<InboundRequest>>(`/inbound-requests?${q.toString()}`);
  },
  getById: (id: string) => request<InboundRequest>(`/inbound-requests/${id}`),
  create: (data: unknown) =>
    request<InboundRequest>("/inbound-requests", { method: "POST", body: JSON.stringify(data) }),
  receive: (id: string, data: { receivedItems: unknown[] }) =>
    request<InboundRequest>(`/inbound-requests/${id}/receive`, { method: "POST", body: JSON.stringify(data) }),
  cancel: (id: string, reason?: string) =>
    request<InboundRequest>(`/inbound-requests/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),
  // v1.6.1 (2026-05-15): 해외 발주에서 입고 큐 생성
  createFromOverseasOrder: (orderId: string) =>
    request<InboundRequest>(`/inbound-requests/from-overseas-order/${orderId}`, { method: "POST" }),
};

// bomDefinitionApi 폐기 (v1.6 B안, 2026-05-13):
//   BOM 정의는 ProductMaster(itemType=BUNDLE)로 통합.
//   procurementApi.getBundleItems / replaceBundleItems 사용.

export const bundleShipmentApi = {
  list: (params?: { customerId?: string; from?: string; to?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    return request<Paginated<BundleShipment>>(`/bundle-shipments?${q.toString()}`);
  },
  getById: (id: string) => request<BundleShipment>(`/bundle-shipments/${id}`),
  getSiblingAssets: (id: string) =>
    request<any>(`/bundle-shipments/${id}/sibling-assets`),
  create: (data: unknown) =>
    request<BundleShipment>("/bundle-shipments", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: unknown) =>
    request<any>(`/bundle-shipments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};
