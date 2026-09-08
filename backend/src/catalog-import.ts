import type { CatalogProduct } from "./catalog.js";
import { validateCatalogProducts } from "./catalog.js";

export type ImportStore = {
  findByPresetIds(ids: string[]): Promise<CatalogProduct[]>;
  upsert(product: CatalogProduct): Promise<void>;
};
export type ImportSummary = { create: number; update: number; unchanged: number; conflict: number; applied: boolean };
const stable = (value: CatalogProduct) => JSON.stringify(value);
export const guardProductionImport = (env: NodeJS.ProcessEnv) => {
  if (env.NODE_ENV === "production" && env.ALLOW_PRODUCTION_CATALOG_IMPORT !== "true") throw new Error("Production catalog import refused. Set ALLOW_PRODUCTION_CATALOG_IMPORT=true only after operator review.");
};
export const importCatalog = async (products: CatalogProduct[], store: ImportStore, apply = false): Promise<ImportSummary> => {
  const issues = validateCatalogProducts(products); if (issues.length) throw new Error(`Catalog validation failed: ${issues.map((i) => `${i.presetId}.${i.field}:${i.code}`).join(", ")}`);
  const existing = new Map((await store.findByPresetIds(products.map((p) => p.presetId))).map((p) => [p.presetId, p]));
  const summary: ImportSummary = { create: 0, update: 0, unchanged: 0, conflict: 0, applied: apply };
  for (const product of products) { const current = existing.get(product.presetId); if (!current) summary.create++; else if (stable(current) === stable(product)) summary.unchanged++; else summary.update++; if (apply && (!current || stable(current) !== stable(product))) await store.upsert(product); }
  return summary;
};
