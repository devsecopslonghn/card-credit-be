import mongoose, { Schema } from "mongoose";

const MonthDataSchema = new Schema({
  month: { type: Number, required: true }, spend: { type: Number, default: 0 },
  cashback: { type: Number, default: 0 }, fee: { type: Number, default: 0 },
  otherInterest: { type: Number, default: 0 },
}, { _id: false });

const CreditCardSchema = new Schema({
  userId: { type: String, default: null }, workspaceId: { type: String, default: null, index: true },
  presetId: { type: String, default: null, index: true }, providerCode: { type: String, default: null },
  providerName: { type: String, default: null }, displayName: { type: String, default: null },
  network: { type: String, default: null }, catalogVersion: { type: String, default: null },
  legacy: { type: Boolean, default: true }, bank: { type: String, required: true },
  name: { type: String, required: true }, type: { type: String, required: true }, owner: { type: String, default: "Tôi" },
  imageUrl: { type: String, required: true }, annualFee: { type: Number, default: null },
  targetSpendForWaiver: { type: Number, default: 0 }, annualFeeWaiverTarget: { type: Number, default: null },
  statementDay: { type: Number, default: 1, min: 1, max: 31 }, paymentDueDays: { type: Number, default: 15, min: 1 },
  cashbackCapAmount: { type: Number, default: null, min: 0 },
  cashbackCapPeriod: { type: String, enum: ["STATEMENT", "CALENDAR_MONTH"], default: "STATEMENT" },
  active: { type: Boolean, default: true }, statementDate: { type: String, default: "" },
  retiredAt: { type: Date, default: null },
  mergedIntoCardId: { type: Schema.Types.ObjectId, ref: "CreditCard", default: null },
  reminderEnabled: { type: Boolean, default: false },
  reminderDaysBefore: { type: [Number], default: [7, 3, 1] },
  reminderTimezone: { type: String, default: "Asia/Ho_Chi_Minh" },
  reminderTime: { type: String, default: "08:00" },
  paymentDueDate: { type: String, default: "" }, amountDueThisMonth: { type: Number, default: 0 },
  isPaidThisMonth: { type: Boolean, default: false }, monthlyData: { type: [MonthDataSchema], default: [] },
}, { timestamps: true });
CreditCardSchema.index({ workspaceId: 1, createdAt: -1 });
CreditCardSchema.index({ workspaceId: 1, owner: 1 });
CreditCardSchema.index({ workspaceId: 1, mergedIntoCardId: 1 });
export const CreditCardModel = (mongoose.models.CreditCard ?? mongoose.model("CreditCard", CreditCardSchema)) as mongoose.Model<Record<string, unknown>>;
