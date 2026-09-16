import mongoose, { Schema } from "mongoose";

const CreditCardSchema = new Schema({
  userId: { type: String, default: null }, workspaceId: { type: String, required: true, index: true },
  presetId: { type: String, required: true, index: true }, providerCode: { type: String, required: true },
  providerName: { type: String, required: true }, displayName: { type: String, required: true },
  network: { type: String, required: true }, catalogVersion: { type: String, required: true },
  owner: { type: String, required: true },
  imageUrl: { type: String, required: true }, annualFee: { type: Number, default: null },
  targetSpendForWaiver: { type: Number, default: 0 }, annualFeeWaiverTarget: { type: Number, default: null },
  statementDay: { type: Number, default: 1, min: 1, max: 31 }, paymentDueDays: { type: Number, default: 15, min: 1 },
  cashbackCapAmount: { type: Number, default: null, min: 0 },
  cashbackCapPeriod: { type: String, enum: ["STATEMENT", "CALENDAR_MONTH"], default: "STATEMENT" },
  active: { type: Boolean, default: true },
  retiredAt: { type: Date, default: null },
  mergedIntoCardId: { type: Schema.Types.ObjectId, ref: "CreditCard", default: null },
  reminderEnabled: { type: Boolean, default: false },
  reminderDaysBefore: { type: [Number], default: [7, 3, 1] },
  reminderTimezone: { type: String, default: "Asia/Ho_Chi_Minh" },
  reminderTime: { type: String, default: "08:00" },
}, { timestamps: true });
CreditCardSchema.index({ workspaceId: 1, createdAt: -1 });
CreditCardSchema.index({ workspaceId: 1, owner: 1 });
CreditCardSchema.index({ workspaceId: 1, mergedIntoCardId: 1 });
export const CreditCardModel = (mongoose.models.CreditCard ?? mongoose.model("CreditCard", CreditCardSchema)) as mongoose.Model<Record<string, unknown>>;
