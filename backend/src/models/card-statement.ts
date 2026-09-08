import mongoose, { Schema } from "mongoose";

const CardStatementSchema = new Schema(
  {
    userId: { type: String, default: null },
    workspaceId: { type: String, required: true },
    userCardId: {
      type: Schema.Types.ObjectId,
      ref: "CreditCard",
      required: true,
    },
    periodStartDate: { type: String, required: true },
    periodEndDate: { type: String, required: true },
    statementDate: { type: String, required: true },
    paymentDueDate: { type: String, required: true },
    statementDaySnapshot: { type: Number, required: true, min: 1, max: 31 },
    paymentDueDaysSnapshot: { type: Number, required: true, min: 1 },
    paymentStatus: {
      type: String,
      enum: ["OPEN", "STATEMENT_CLOSED", "PAID", "OVERDUE"],
      default: "OPEN",
    },
    paidAt: { type: Date, default: null },
    paidAmount: { type: Number, default: null },
  },
  { timestamps: true },
);
CardStatementSchema.index(
  { workspaceId: 1, userCardId: 1, statementDate: 1 },
  { unique: true },
);
CardStatementSchema.index({
  workspaceId: 1,
  paymentStatus: 1,
  paymentDueDate: 1,
});
export const CardStatementModel = (mongoose.models.CardStatement ??
  mongoose.model("CardStatement", CardStatementSchema)) as mongoose.Model<
  Record<string, unknown>
>;
