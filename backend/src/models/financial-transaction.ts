import mongoose, { Schema } from "mongoose";

const FinancialTransactionSchema = new Schema(
  {
    userId: { type: String, required: true },
    workspaceId: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    statementId: { type: Schema.Types.ObjectId, ref: "CardStatement", default: null },
    reimbursementForTransactionId: { type: Schema.Types.ObjectId, ref: "FinancialTransaction", default: null },
    accountType: { type: String, enum: ["DEBIT", "CASH", "E_WALLET", "CREDIT"], required: true },
    transactionType: {
      type: String,
      enum: ["EXPENSE", "TRANSFER", "REIMBURSEMENT", "REFUND", "CASHBACK", "INCOME", "STATEMENT_PAYMENT", "BALANCE_ADJUSTMENT", "OPENING_BALANCE_ADJUSTMENT"],
      required: true,
    },
    direction: { type: String, enum: ["INCREASE", "DECREASE"], default: null },
    targetMetric: { type: String, enum: ["currentBalance", "currentDebt"], default: null },
    technicalDelta: { type: Number, default: 0 },
    ownership: { type: String, enum: ["PERSONAL", "PAID_FOR_OTHER"], default: "PERSONAL" },
    amount: { type: Number, required: true, min: 1 },
    reimbursementExpected: { type: Number, default: 0, min: 0 },
    serviceFeeRate: { type: Number, default: 0, min: 0, max: 100 },
    refundReceived: { type: Number, default: 0, min: 0 },
    cashbackReceived: { type: Number, default: 0, min: 0 },
    categoryId: { type: String, default: "OTHER" },
    transactionDate: { type: String, required: true },
    note: { type: String, default: "", maxlength: 1000 },
    // Calculated once by the domain service and retained for audit/reporting.
    personalSpending: { type: Number, required: true, min: 0 },
    debitCashflow: { type: Number, required: true },
    creditDebt: { type: Number, required: true },
    outstandingReceivable: { type: Number, required: true, min: 0 },
    reimbursementReceived: { type: Number, required: true, min: 0 },
    receivableStatus: { type: String, enum: ["OPEN", "SETTLED", "COLLECTED"], default: null },
    receivableVersion: { type: Number, default: 0, min: 0 },
    receivableSettledAmount: { type: Number, default: 0, min: 0 },
    receivableSettledAt: { type: Date, default: null },
    receivableSettlementReason: { type: String, default: null, maxlength: 500 },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);

FinancialTransactionSchema.pre(/^find/, function () { (this as unknown as { where: (filter: Record<string, unknown>) => unknown }).where({ voidedAt: null }); });
FinancialTransactionSchema.pre("aggregate", function () { this.pipeline().unshift({ $match: { voidedAt: null } }); });

FinancialTransactionSchema.index({ workspaceId: 1, transactionDate: -1, createdAt: -1 });
FinancialTransactionSchema.index({ workspaceId: 1, accountId: 1, transactionDate: -1 });
FinancialTransactionSchema.index({ workspaceId: 1, categoryId: 1, transactionDate: -1 });
FinancialTransactionSchema.index({ workspaceId: 1, transactionType: 1, ownership: 1, receivableStatus: 1 }, { name: "receivable_status_lookup" });
FinancialTransactionSchema.index({ workspaceId: 1, transactionType: 1, reimbursementForTransactionId: 1 }, { name: "reimbursement_source_lookup" });
FinancialTransactionSchema.index(
  { workspaceId: 1, statementId: 1, transactionType: 1 },
  {
    name: "statement_payment_unique",
    unique: true,
    partialFilterExpression: { transactionType: "STATEMENT_PAYMENT", statementId: { $type: "objectId" }, voidedAt: null },
  },
);
export const FinancialTransactionModel =
  (mongoose.models.FinancialTransaction ??
    mongoose.model("FinancialTransaction", FinancialTransactionSchema)) as mongoose.Model<
    Record<string, unknown>
  >;
