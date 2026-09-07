import mongoose from "mongoose";
import { canonicalPayloadHash } from "../command-hash.js";
import { ApiError } from "../errors.js";
import { planLegacyStatementPaymentRepairs, reconciliationIdOf, reconciliationPlanHash, type LegacyPaymentAccount, type LegacyPaymentStatement, type LegacyPaymentTransaction } from "../finance-reconciliation.js";
import { AccountModel } from "../models/account.js";
import { CardStatementModel } from "../models/card-statement.js";
import { FinancialReconciliationCaseModel } from "../models/financial-reconciliation-case.js";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { commandGuardService } from "./command-guard-service.js";
import type { ServiceContext } from "./types/service-context.js";

type Data = Record<string, unknown>;

export type MarkLegacyStatementPaymentInput = {
  caseId: string;
  sourceHash: string;
  planHash: string;
  currentSourceHash: string;
  currentPlanHash: string;
  expectedStatus: "OPEN" | "STATEMENT_CLOSED";
  idempotencyKey: string;
};

export type MarkLegacyStatementPaymentResult = {
  status: "APPLIED";
  caseId: string;
  statementId: string;
  transactionId: string;
  paymentStatus: "PAID";
  paidAmount: number;
  paidAt: string;
};

const hashPattern = /^[a-f0-9]{64}$/i;
const idOf = reconciliationIdOf;
const reject = (code: string, message: string, statusCode = 409): never => {
  throw new ApiError(statusCode, code, message);
};
const snapshotOf = (value: unknown) => value && typeof value === "object" ? value as Data : {};

/**
 * Applies only an already reviewed deterministic case. It never creates,
 * deletes or reverses a financial transaction and is intentionally job-only.
 */
export const markLegacyStatementPaymentPaid = async (
  ctx: ServiceContext,
  input: MarkLegacyStatementPaymentInput,
): Promise<MarkLegacyStatementPaymentResult> => {
  if (!mongoose.isValidObjectId(input.caseId)) reject("INVALID_RECONCILIATION_CASE", "Reconciliation case id is invalid.", 400);
  if (![input.sourceHash, input.planHash, input.currentSourceHash, input.currentPlanHash].every((value) => hashPattern.test(value))) reject("INVALID_RECONCILIATION_REVIEW", "Reviewed reconciliation hashes are invalid.", 400);
  if (ctx.channel !== "job" || ctx.role !== "admin" || !ctx.userId.trim()) reject("INVALID_RECONCILIATION_OPERATOR", "A trusted admin job operator is required.", 403);
  const payloadHash = canonicalPayloadHash({ caseId: input.caseId, sourceHash: input.sourceHash, planHash: input.planHash, ...(input.currentSourceHash !== input.sourceHash || input.currentPlanHash !== input.planHash ? { currentSourceHash: input.currentSourceHash, currentPlanHash: input.currentPlanHash } : {}), expectedStatus: input.expectedStatus });
  return commandGuardService.execute(ctx, {
    operation: "mark_legacy_statement_payment_paid",
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    endpointOrTool: "backend/scripts/mark-legacy-statement-payment-paid.ts",
    resource: { type: "reconciliation_case", id: input.caseId },
  }, async (session) => {
    const reconciliationCase = await FinancialReconciliationCaseModel.findOne({ _id: input.caseId, workspaceId: ctx.workspaceId } as never).session(session).lean() as Data | null;
    if (!reconciliationCase) throw new ApiError(404, "RECONCILIATION_CASE_NOT_FOUND", "Reconciliation case was not found.");
    const caseId = idOf(reconciliationCase?._id);
    const statementId = idOf(reconciliationCase?.statementId);
    const transactionId = idOf(reconciliationCase?.transactionId);
    const snapshot = snapshotOf(reconciliationCase?.snapshot);
    if (reconciliationCase?.kind !== "LEGACY_STATEMENT_PAYMENT" || reconciliationCase.classification !== "ELIGIBLE_MARK_PAID") reject("RECONCILIATION_CASE_NOT_ELIGIBLE", "Reconciliation case is not eligible for mark-paid.");
    if (snapshot.sourceHash !== input.sourceHash || snapshot.planHash !== input.planHash) reject("RECONCILIATION_REVIEW_MISMATCH", "Reviewed reconciliation hashes do not match the case.");
    if (!mongoose.isValidObjectId(statementId) || !mongoose.isValidObjectId(transactionId)) reject("RECONCILIATION_CASE_INVALID", "Reconciliation case references are invalid.");
    if (reconciliationCase.status !== "OPEN") reject("RECONCILIATION_CASE_NOT_OPEN", "Reconciliation case is not open.");
    if (snapshot.previousStatus !== input.expectedStatus) reject("RECONCILIATION_EXPECTED_STATUS_MISMATCH", "Expected statement status does not match the reviewed case.");

    const statement = await CardStatementModel.findOne({ _id: statementId, workspaceId: ctx.workspaceId }).session(session).lean() as Data | null;
    if (!statement) throw new ApiError(404, "STATEMENT_NOT_FOUND", "Statement was not found.");
    const [allStatements, transactions, accounts] = await Promise.all([
      CardStatementModel.find({ workspaceId: ctx.workspaceId }).session(session).lean(),
      FinancialTransactionModel.find({ workspaceId: ctx.workspaceId }).session(session).lean(),
      AccountModel.find({ workspaceId: ctx.workspaceId }).session(session).lean(),
    ]) as [Data[], Data[], Data[]];
    const plan = planLegacyStatementPaymentRepairs(
      allStatements as LegacyPaymentStatement[],
      transactions as LegacyPaymentTransaction[],
      accounts as LegacyPaymentAccount[],
    );
    if (plan.sourceHash !== input.currentSourceHash || reconciliationPlanHash(plan) !== input.currentPlanHash) reject("RECONCILIATION_SOURCE_DRIFT", "Statement or ledger data changed after the current plan review.");
    const targetRepairs = plan.repairs.filter((item) => item.statementId === statementId && item.transactionId === transactionId);
    const targetSkips = plan.skipped.filter((item) => item.statementId === statementId || item.transactionIds.includes(transactionId));
    if (targetSkips.length !== 0 || targetRepairs.length !== 1) reject("RECONCILIATION_PRECONDITION_FAILED", "The reviewed full-settlement precondition is no longer true.");
    const repair = targetRepairs[0];
    if (!repair) throw new ApiError(409, "RECONCILIATION_PRECONDITION_FAILED", "The reviewed repair is missing.");

    const updatedStatement = await CardStatementModel.findOneAndUpdate(
      { _id: statementId, workspaceId: ctx.workspaceId, paymentStatus: input.expectedStatus, paidAt: null, paidAmount: null, updatedAt: statement.updatedAt },
      { $set: { paymentStatus: "PAID", paidAmount: repair.amount, paidAt: repair.paidAt } },
      { returnDocument: "after", session } as never,
    ).lean() as Data | null;
    if (!updatedStatement) reject("RECONCILIATION_STATE_CONFLICT", "Statement state changed before mark-paid.");

    const resolved = await FinancialReconciliationCaseModel.findOneAndUpdate(
      { _id: input.caseId, workspaceId: ctx.workspaceId, status: "OPEN", classification: "ELIGIBLE_MARK_PAID", "snapshot.sourceHash": input.sourceHash, "snapshot.planHash": input.planHash } as never,
      { $set: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: ctx.userId.trim(), snapshot: input.currentSourceHash === input.sourceHash && input.currentPlanHash === input.planHash ? snapshot : { ...snapshot, sourceHash: input.currentSourceHash, planHash: input.currentPlanHash, reviewedSourceHash: input.sourceHash, reviewedPlanHash: input.planHash } } },
      { returnDocument: "after", session } as never,
    ).lean() as Data | null;
    if (!resolved) reject("RECONCILIATION_CASE_CONFLICT", "Reconciliation case changed before resolution.");

    return { status: "APPLIED", caseId, statementId, transactionId, paymentStatus: "PAID", paidAmount: repair.amount, paidAt: repair.paidAt.toISOString() };
  });
};
