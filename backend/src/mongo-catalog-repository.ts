import type { Model } from "mongoose";
import { ApiError } from "./errors.js";
import type { CatalogProduct, CatalogRepository } from "./catalog.js";
import { CardProductModel } from "./models/card-product.js";

const fields = "presetId providerCode providerName displayName network segment annualFee targetSpendForWaiver imageUrl benefits sourceUrl sourceCheckedAt active sortOrder theme -_id";
export class MongoCatalogRepository implements CatalogRepository {
  constructor(private readonly model: Model<CatalogProduct> = CardProductModel as Model<CatalogProduct>) {}
  async listAllProducts() { return this.model.find().select(fields).sort({ sortOrder: 1 }).lean<CatalogProduct[]>().exec(); }
  async listActiveProducts(providerCode?: string) { return this.model.find({ active: true, ...(providerCode ? { providerCode } : {}) }).select(fields).sort({ sortOrder: 1 }).lean<CatalogProduct[]>().exec(); }
  async getActiveProduct(presetId: string) { return this.model.findOne({ presetId, active: true }).select(fields).lean<CatalogProduct>().exec(); }
  async listActiveProviders() { const groups = new Map<string, { providerCode: string; providerName: string; products: CatalogProduct[] }>(); for (const p of await this.listActiveProducts()) { const g = groups.get(p.providerCode) ?? { providerCode: p.providerCode, providerName: p.providerName, products: [] }; g.products.push(p); groups.set(p.providerCode, g); } return [...groups.values()].sort((a, b) => a.providerName.localeCompare(b.providerName)); }
  async createProduct(product: CatalogProduct) { try { const created = await this.model.create(product); return created.toObject({ versionKey: false, transform: (_doc, ret) => { delete (ret as Record<string, unknown>)._id; return ret; } }) as CatalogProduct; } catch (error) { if ((error as { code?: number }).code === 11000) throw new ApiError(409, "INVALID_REQUEST", "Card Product đã tồn tại.", { presetId: "presetId bị trùng." }); throw error; } }
  async updateProduct(presetId: string, product: CatalogProduct) { return this.model.findOneAndUpdate({ presetId }, { $set: product }, { new: true, runValidators: true }).select(fields).lean<CatalogProduct>().exec(); }
  async updateProvider(providerCode: string, update: { providerName?: string; active?: boolean }) { const result = await this.model.updateMany({ providerCode }, { $set: update }, { runValidators: true }); return result.matchedCount; }
}
