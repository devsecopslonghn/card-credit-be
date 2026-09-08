import { ApiError } from "./errors.js";
import type { CatalogProductDto, CatalogProviderDto } from "@card-credit/contracts";

export const CATALOG_NETWORKS = ["Visa", "Mastercard", "JCB", "American Express", "UnionPay", "Napas"] as const;

export type CatalogProduct = CatalogProductDto;
export type CatalogProvider = CatalogProviderDto;
type CatalogProductCandidate = Omit<CatalogProduct, "network"> & { network: string };

export type CatalogIssue = { presetId: string; field: string; code: string };

export interface CatalogRepository {
  listActiveProviders(): Promise<CatalogProvider[]>;
  listActiveProducts(providerCode?: string): Promise<CatalogProduct[]>;
  getActiveProduct(presetId: string): Promise<CatalogProduct | null>;
  listAllProducts(): Promise<CatalogProduct[]>;
  createProduct(product: CatalogProduct): Promise<CatalogProduct>;
  updateProduct(presetId: string, product: CatalogProduct): Promise<CatalogProduct | null>;
  updateProvider(providerCode: string, update: { providerName?: string; active?: boolean }): Promise<number>;
}

const httpUrl = (value: string) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
};

export const validateCatalogProducts = (products: CatalogProductCandidate[]): CatalogIssue[] => {
  const issues: CatalogIssue[] = [];
  const ids = new Set<string>();
  const orders = new Set<number>();
  const issue = (product: Partial<CatalogProductCandidate>, field: string, code: string) =>
    issues.push({ presetId: product.presetId || "unknown", field, code });
  for (const product of products) {
    if (!product.presetId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.presetId)) issue(product, "presetId", "INVALID_PRESET_ID");
    if (ids.has(product.presetId)) issue(product, "presetId", "DUPLICATE_PRESET_ID");
    ids.add(product.presetId);
    if (!product.providerCode || !/^[A-Z0-9]+$/.test(product.providerCode)) issue(product, "providerCode", "INVALID_PROVIDER_CODE");
    if (!product.providerName?.trim()) issue(product, "providerName", "MISSING_PROVIDER_NAME");
    if (!product.displayName?.trim()) issue(product, "displayName", "MISSING_DISPLAY_NAME");
    if (!CATALOG_NETWORKS.includes(product.network as typeof CATALOG_NETWORKS[number])) issue(product, "network", "INVALID_NETWORK");
    if (product.annualFee !== null && (typeof product.annualFee !== "number" || product.annualFee < 0)) issue(product, "annualFee", "INVALID_ANNUAL_FEE");
    if (typeof product.active !== "boolean") issue(product, "active", "INVALID_ACTIVE");
    if (!Number.isFinite(product.sortOrder)) issue(product, "sortOrder", "INVALID_SORT_ORDER");
    else if (orders.has(product.sortOrder)) issue(product, "sortOrder", "DUPLICATE_SORT_ORDER");
    orders.add(product.sortOrder);
    if (product.active && !httpUrl(product.sourceUrl)) issue(product, "sourceUrl", "INVALID_SOURCE_URL");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(product.sourceCheckedAt)) issue(product, "sourceCheckedAt", "INVALID_SOURCE_CHECKED_AT");
    if (!Array.isArray(product.benefits) || product.benefits.some((value) => typeof value !== "string")) issue(product, "benefits", "INVALID_BENEFITS");
    if (!product.theme || typeof product.theme.background !== "string" || typeof product.theme.accent !== "string") issue(product, "theme", "INVALID_THEME");
  }
  return issues;
};

export const normalizeCatalogProduct = (input: Record<string, unknown>): CatalogProduct => ({
  presetId: typeof input.presetId === "string" ? input.presetId.trim() : "",
  providerCode: typeof input.providerCode === "string" ? input.providerCode.trim().toUpperCase() : "",
  providerName: typeof input.providerName === "string" ? input.providerName.trim() : "",
  displayName: typeof input.displayName === "string" ? input.displayName.trim() : "",
  network: (typeof input.network === "string" ? input.network.trim() : "") as CatalogProduct["network"],
  segment: typeof input.segment === "string" ? input.segment.trim() : "",
  annualFee: typeof input.annualFee === "number" ? input.annualFee : null,
  targetSpendForWaiver: typeof input.targetSpendForWaiver === "number" ? input.targetSpendForWaiver : null,
  imageUrl: typeof input.imageUrl === "string" && input.imageUrl ? input.imageUrl : null,
  benefits: Array.isArray(input.benefits) ? input.benefits.filter((v): v is string => typeof v === "string") : [],
  sourceUrl: typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "",
  sourceCheckedAt: typeof input.sourceCheckedAt === "string" ? input.sourceCheckedAt.trim() : "",
  active: input.active as boolean,
  sortOrder: input.sortOrder as number,
  theme: input.theme as CatalogProduct["theme"],
});

export const invalidCatalogError = (issues: CatalogIssue[]) => new ApiError(400, "INVALID_REQUEST", "Catalog không hợp lệ.", { catalog: issues.map((i) => `${i.presetId}.${i.field}: ${i.code}`).join("; ") });

export class InMemoryCatalogRepository implements CatalogRepository {
  constructor(private products: CatalogProduct[] = []) { this.products = structuredClone(products); }
  async listAllProducts() { return structuredClone(this.products).sort((a, b) => a.sortOrder - b.sortOrder); }
  async listActiveProducts(providerCode?: string) { return (await this.listAllProducts()).filter((p) => p.active && (!providerCode || p.providerCode === providerCode)); }
  async getActiveProduct(presetId: string) { return structuredClone(this.products.find((p) => p.active && p.presetId === presetId) ?? null); }
  async listActiveProviders() {
    const groups = new Map<string, { providerCode: string; providerName: string; products: CatalogProduct[] }>();
    for (const p of await this.listActiveProducts()) { const g = groups.get(p.providerCode) ?? { providerCode: p.providerCode, providerName: p.providerName, products: [] }; g.products.push(p); groups.set(p.providerCode, g); }
    return [...groups.values()].sort((a, b) => a.providerName.localeCompare(b.providerName));
  }
  async createProduct(product: CatalogProduct) { if (this.products.some((p) => p.presetId === product.presetId)) throw new ApiError(409, "INVALID_REQUEST", "Card Product đã tồn tại.", { presetId: "presetId bị trùng." }); this.products.push(structuredClone(product)); return structuredClone(product); }
  async updateProduct(presetId: string, product: CatalogProduct) { const index = this.products.findIndex((p) => p.presetId === presetId); if (index < 0) return null; this.products[index] = structuredClone(product); return structuredClone(product); }
  async updateProvider(providerCode: string, update: { providerName?: string; active?: boolean }) { let count = 0; this.products = this.products.map((p) => p.providerCode === providerCode ? (count++, { ...p, ...update }) : p); return count; }
}
