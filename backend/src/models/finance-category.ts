import mongoose, { Schema } from "mongoose";

const FinanceCategorySchema = new Schema(
  {
    workspaceId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    parentId: { type: String, default: null },
    active: { type: Boolean, default: true },
    system: { type: Boolean, default: false },
  },
  { timestamps: true },
);
FinanceCategorySchema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const FinanceCategoryModel = mongoose.models.FinanceCategory ?? mongoose.model("FinanceCategory", FinanceCategorySchema);
