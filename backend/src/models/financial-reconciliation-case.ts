import mongoose, { Schema } from "mongoose";

export type ReconciliationCaseClassification = "ELIGIBLE_MARK_PAID" | "QUARANTINE_REQUIRED";
export type ReconciliationCaseDocument = {
  _id?: unknown;
  workspaceId: string;
  kind: "LEGACY_STATEMENT_PAYMENT";
  statementId: unknown;
  transactionId: unknown;
  classification: ReconciliationCaseClassification;
  reason: string;
  snapshot: Record<string, unknown>;
  status: "OPEN" | "RESOLVED";
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  createdAt?: Date;
};

const FinancialReconciliationCaseSchema = new Schema<ReconciliationCaseDocument>({
  workspaceId: { type: String, required: true },
  kind: { type: String, enum: ["LEGACY_STATEMENT_PAYMENT"], required: true },
  statementId: { type: Schema.Types.ObjectId, required: true },
  transactionId: { type: Schema.Types.ObjectId, required: true },
  classification: { type: String, enum: ["ELIGIBLE_MARK_PAID", "QUARANTINE_REQUIRED"], required: true },
  reason: { type: String, required: true, maxlength: 160 },
  snapshot: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null, maxlength: 160 },
}, { timestamps: { createdAt: true, updatedAt: false } });

FinancialReconciliationCaseSchema.index(
  { workspaceId: 1, kind: 1, transactionId: 1 },
  { name: "reconciliation_case_unique", unique: true },
);
FinancialReconciliationCaseSchema.index(
  { workspaceId: 1, status: 1, createdAt: -1 },
  { name: "reconciliation_case_workspace_status" },
);

export const FinancialReconciliationCaseModel = (mongoose.models.FinancialReconciliationCase ?? mongoose.model<ReconciliationCaseDocument>("FinancialReconciliationCase", FinancialReconciliationCaseSchema, "financialreconciliationcases"));
