export class EquipmentServiceClient {
  private baseUrl: string;
  private internalToken: string;

  constructor(baseUrl: string, internalToken: string) {
    this.baseUrl = baseUrl;
    this.internalToken = internalToken;
  }

  async applyImportCost(data: Record<string, unknown>): Promise<{ id: string }> {
    return this.post("/api/v1/procurement/settlements", data);
  }

  async applyOverseasOrder(data: Record<string, unknown>): Promise<{ id: string }> {
    return this.post("/api/v1/procurement/orders", data);
  }

  async applyInventory(data: Record<string, unknown>): Promise<{ id: string }> {
    return this.post("/api/v1/inventory/items", data);
  }

  private async post(path: string, data: Record<string, unknown>): Promise<{ id: string }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": this.internalToken,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ERP service error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<{ id: string }>;
  }
}
