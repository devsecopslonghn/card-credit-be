import mongoose, { Schema } from "mongoose";

const MasterScope = { type: String, enum: ["GLOBAL"], default: "GLOBAL", immutable: true } as const;

const BankSchema = new Schema({
  scope: MasterScope,
  shortname: { type: String, required: true, trim: true, maxlength: 40 },
  name: { type: String, default: "", trim: true, maxlength: 120 },
  fullname: { type: String, default: "", trim: true, maxlength: 200 },
  logo: { type: String, default: "" },
}, { timestamps: true, collection: "banks" });
BankSchema.index({ shortname: 1 }, { unique: true });
BankSchema.index({ name: 1 });

const CardTypeSchema = new Schema({
  scope: MasterScope,
  name: { type: String, required: true, trim: true, maxlength: 120 },
  logo: { type: String, default: "" },
}, { timestamps: true, collection: "cardtypes" });
CardTypeSchema.index({ name: 1 }, { unique: true });

export const BankModel = (mongoose.models.Bank ?? mongoose.model("Bank", BankSchema)) as mongoose.Model<Record<string, unknown>>;
export const CardTypeModel = (mongoose.models.CardType ?? mongoose.model("CardType", CardTypeSchema)) as mongoose.Model<Record<string, unknown>>;
