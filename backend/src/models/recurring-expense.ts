import mongoose, { Schema } from "mongoose";
const RecurringExpenseSchema = new Schema({
  workspaceId: { type: String, required: true }, userId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 120 }, categoryId: { type: String, required: true },
  accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true }, expectedAmount: { type: Number, required: true, min: 1 },
  frequency: { type: String, enum: ["MONTHLY"], default: "MONTHLY" }, nextDueDate: { type: String, required: true }, active: { type: Boolean, default: true },
}, { timestamps: true });
RecurringExpenseSchema.index({ workspaceId: 1, active: 1, nextDueDate: 1 });
export const RecurringExpenseModel = mongoose.models.RecurringExpense ?? mongoose.model("RecurringExpense", RecurringExpenseSchema);
