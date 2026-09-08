import mongoose, { Schema } from "mongoose";
import { CATALOG_NETWORKS } from "../catalog.js";

const CardProductSchema = new Schema({
  presetId: { type: String, required: true, unique: true, immutable: true },
  providerCode: { type: String, required: true, index: true },
  providerName: { type: String, required: true }, displayName: { type: String, required: true },
  network: { type: String, required: true, enum: CATALOG_NETWORKS }, segment: { type: String, required: true },
  annualFee: { type: Number, default: null, min: 0 }, targetSpendForWaiver: { type: Number, default: null, min: 0 },
  imageUrl: { type: String, default: null }, benefits: { type: [String], default: [] },
  sourceUrl: { type: String, required: true }, sourceCheckedAt: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  active: { type: Boolean, required: true, index: true }, sortOrder: { type: Number, required: true, index: true },
  theme: { background: { type: String, required: true }, accent: { type: String, required: true } },
}, { timestamps: true, versionKey: false });
CardProductSchema.index({ providerCode: 1, active: 1, sortOrder: 1 });
export const CardProductModel = mongoose.models.CardProduct ?? mongoose.model("CardProduct", CardProductSchema);
