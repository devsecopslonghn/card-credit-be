import mongoose, { Schema } from "mongoose";

const FinanceBudgetSchema = new Schema(
  {
    workspaceId: { type: String, required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    categoryId: { type: String, required: true },
    limitAmount: { type: Number, required: true, min: 1 },
    warningPercent: { type: Number, default: 80, min: 1, max: 100 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
FinanceBudgetSchema.index({ workspaceId: 1, month: 1, categoryId: 1 }, { unique: true });
export const FinanceBudgetModel = mongoose.models.FinanceBudget ?? mongoose.model("FinanceBudget", FinanceBudgetSchema);
