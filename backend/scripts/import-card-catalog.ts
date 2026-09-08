import mongoose from "mongoose";
import type { Model } from "mongoose";
import { guardProductionImport, importCatalog } from "../src/catalog-import.js";
import { catalogPath, readCatalogFile } from "../src/catalog-sync.js";
import type { CatalogProduct } from "../src/catalog.js";
import { CardProductModel } from "../src/models/card-product.js";

guardProductionImport(process.env);
const uri = process.env.MONGODB_URI?.trim(); if (!uri) throw new Error("MONGODB_URI is required");
const apply = process.argv.includes("--apply");
const products = await readCatalogFile(catalogPath());
const model = CardProductModel as unknown as Model<CatalogProduct>;
await mongoose.connect(uri);
try {
  const summary = await importCatalog(products, {
    async findByPresetIds(ids) { return model.find({ presetId: { $in: ids } }).select("presetId providerCode providerName displayName network segment annualFee targetSpendForWaiver imageUrl benefits sourceUrl sourceCheckedAt active sortOrder theme -_id").lean<CatalogProduct[]>().exec(); },
    async upsert(product) { await model.updateOne({ presetId: product.presetId }, { $set: product }, { upsert: true, runValidators: true }); },
  }, apply);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...summary }));
} finally { await mongoose.disconnect(); }
