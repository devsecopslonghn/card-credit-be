import mongoose from "mongoose";
import { statementPaymentActionSchema, statementPaymentInputSchema, statementPaymentPreviewDataSchema, type StatementPaymentAction, type StatementPaymentInput, type StatementPaymentPreviewDataDto, type StatementPaymentPreviewDto } from "@card-credit/contracts";
import { calculateFinancialImpact, type AccountType } from "../financial-domain.js";
import { ApiError } from "../errors.js";
import { AccountModel } from "../models/account.js";
import { CardStatementModel } from "../models/card-statement.js";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import type { ServiceContext } from "./types/service-context.js";
import { canonicalPayloadHash } from "../command-hash.js";
import { commandGuardService, type CommandInvocation } from "./command-guard-service.js";

type Data = Record<string, unknown>;
type PaymentTotals = { statementAmount: number; paymentAmount: number; outstandingAmount: number };

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

/** Canonical ledger totals used by both payment commands and statement reads. */
export const paymentTotals = (transactions: Data[]): PaymentTotals => {
  let statementAmount = 0;
  let paymentAmount = 0;
  for (const transaction of transactions) {
    const type = String(transaction.transactionType ?? "");
    const creditDebt = numberValue(transaction.creditDebt);
    const amount = numberValue(transaction.amount);
    if (type === "STATEMENT_PAYMENT" || creditDebt < 0) paymentAmount += Math.max(-creditDebt, type === "STATEMENT_PAYMENT" ? amount : 0);
    else statementAmount += Math.max(creditDebt, 0);
  }
  return { statementAmount, paymentAmount, outstandingAmount: Math.max(statementAmount - paymentAmount, 0) };
};

export const paidLedgerIsConsistent = (statement: Data, transactions: Data[]) => {
  const totals = paymentTotals(transactions);
  return totals.outstandingAmount === 0 && numberValue(statement.paidAmount) === totals.paymentAmount;
};

const paymentReceiptResult = (statement: Data, statementId: string, action: StatementPaymentAction): Data => ({
  statementId,
  action,
  paymentStatus: statement.paymentStatus ?? null,
  paidAt: statement.paidAt ?? null,
  paidAmount: numberValue(statement.paidAmount),
});

const isPaymentUniqueConflict = (error: unknown) => {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) return false;
  const value = error as { index?: string; keyPattern?: Record<string, unknown>; message?: string };
  return value.index === "statement_payment_unique" || (value.keyPattern?.transactionType !== undefined && value.keyPattern?.statementId !== undefined) || value.message?.includes("statement_payment_unique") === true;
};

const repaymentAccount = async (ctx: ServiceContext, repaymentAccountId: string, session?: mongoose.ClientSession) => {
  if (!mongoose.isValidObjectId(repaymentAccountId)) throw new ApiError(400, "INVALID_PAYMENT_REFERENCE", "Tham chiếu tài khoản trả nợ không hợp lệ.");
  const query = AccountModel.findOne({ _id: repaymentAccountId, workspaceId: ctx.workspaceId, active: { $ne: false } });
  const account = await (session ? query.session(session) : query).lean() as Data | null;
  const accountType = String(account?.type ?? "") as AccountType;
  if (!account || !["DEBIT", "CASH", "E_WALLET"].includes(accountType)) throw new ApiError(400, "INVALID_REPAYMENT_ACCOUNT", "Tài khoản trả nợ phải là DEBIT, CASH hoặc E_WALLET đang hoạt động.");
  return { account, accountType };
};

const versionOf = (value: unknown) => {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) ? date.toISOString() : null;
};

export const paymentCommandPayloadHash = (cardId: string, statementId: string, input: StatementPaymentInput) => canonicalPayloadHash({
  cardId,
  statementId,
  input: {
    action: input.action,
    ...(input.repaymentAccountId ? { repaymentAccountId: input.repaymentAccountId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.reverseErroneousPayment ? { reverseErroneousPayment: true } : {}),
  },
});

/** Stored state transition; effective OVERDUE is represented by OPEN at rest. */
export const nextPaymentState = (current: string, action: StatementPaymentAction, reason?: string) => {
  const parsedAction = statementPaymentActionSchema.safeParse(action);
  if (!parsedAction.success) throw new ApiError(400, "INVALID_PAYMENT_ACTION", "Thao tác thanh toán không hợp lệ.");
  if (parsedAction.data === "PAID") return "PAID" as const;
  if (current === "PAID" && !(parsedAction.data === "REOPEN" && reason?.trim())) throw new ApiError(409, "STATEMENT_PAID_LOCKED", "Kỳ sao kê đã thanh toán; REOPEN cần lý do correction rõ ràng.");
  return parsedAction.data === "CLOSED" ? "STATEMENT_CLOSED" as const : "OPEN" as const;
};

export class StatementPaymentCommandService {
  static async preview(ctx: ServiceContext, cardId: string, statementId: string, input: StatementPaymentInput): Promise<StatementPaymentPreviewDataDto> {
    const parsed = statementPaymentInputSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "INVALID_PAYMENT_ACTION", "Thao tác thanh toán không hợp lệ.");
    const command = parsed.data as StatementPaymentInput;
    if (!mongoose.isValidObjectId(cardId) || !mongoose.isValidObjectId(statementId)) throw new ApiError(400, "INVALID_STATEMENT_ID", "Tham chiếu sao kê không hợp lệ.");
    const statement = await CardStatementModel.findOne({ _id: statementId, userCardId: cardId, workspaceId: ctx.workspaceId }).lean() as Data | null;
    if (!statement) throw new ApiError(404, "STATEMENT_NOT_FOUND", "Không tìm thấy kỳ sao kê.");
    const transactions = await FinancialTransactionModel.find({ statementId, workspaceId: ctx.workspaceId }).lean() as Data[];
    const paymentTransactions = transactions.filter((item) => String(item.transactionType) === "STATEMENT_PAYMENT");
    if (paymentTransactions.length > 1) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Kỳ sao kê có nhiều giao dịch thanh toán.");
    const paymentStatus = String(statement.paymentStatus ?? "OPEN") as StatementPaymentPreviewDataDto["paymentStatus"];
    const nextPaymentStatus = nextPaymentState(paymentStatus, command.action, command.reason);
    if (command.action === "REOPEN" && paymentStatus === "PAID" && paymentTransactions.length > 0 && !command.reverseErroneousPayment) throw new ApiError(409, "STATEMENT_PAYMENT_REVERSAL_REQUIRED", "Không thể REOPEN khi đã có giao dịch thanh toán; cần xác nhận reverseErroneousPayment riêng.");
    const totals = paymentTotals(transactions);
    if (command.action === "PAID" && paymentStatus === "PAID") {
      if (!paidLedgerIsConsistent(statement, transactions)) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Trạng thái paid không khớp với ledger sao kê.");
      if (paymentTransactions.length === 1) {
        const existingAccount = await AccountModel.findOne({ _id: paymentTransactions[0]?.accountId, workspaceId: ctx.workspaceId }).lean() as Data | null;
        if (!existingAccount) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Tài khoản của giao dịch thanh toán không còn thuộc workspace.");
        if (command.repaymentAccountId && String(existingAccount._id) !== command.repaymentAccountId) throw new ApiError(409, "STATEMENT_ALREADY_SETTLED", "Kỳ sao kê đã được thanh toán bằng tài khoản khác.");
      }
    }
    if (command.action === "PAID" && paymentStatus !== "PAID" && paymentTransactions.length === 1) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Kỳ sao kê đã có giao dịch thanh toán nhưng trạng thái chưa được đồng bộ.");
    const amountToPay = command.action === "PAID" && paymentStatus !== "PAID" ? totals.outstandingAmount : 0;
    const requiresRepaymentAccount = amountToPay > 0 && !command.repaymentAccountId;
    if (amountToPay > 0 && command.repaymentAccountId) await repaymentAccount(ctx, command.repaymentAccountId);
    const warnings: StatementPaymentPreviewDataDto["warnings"] = [];
    if (command.action === "PAID" && paymentStatus === "PAID") warnings.push("ALREADY_SETTLED");
    else if (command.action === "PAID" && amountToPay === 0) warnings.push("NO_OUTSTANDING_BALANCE");
    else if (requiresRepaymentAccount) warnings.push("REPAYMENT_ACCOUNT_REQUIRED");
    return statementPaymentPreviewDataSchema.parse({
      operation: "pay_statement",
      cardId,
      statementId,
      action: command.action,
      paymentStatus,
      nextPaymentStatus,
      statementAmount: totals.statementAmount,
      paymentAmount: totals.paymentAmount,
      outstandingAmount: totals.outstandingAmount,
      amountToPay,
      repaymentAccountId: command.repaymentAccountId ?? null,
      version: versionOf(statement.updatedAt),
      requiresRepaymentAccount,
      warnings,
    }) as StatementPaymentPreviewDto;
  }

  static async execute(ctx: ServiceContext, cardId: string, statementId: string, input: StatementPaymentInput, invocation: CommandInvocation, paidAt = new Date()): Promise<Data> {
    const parsed = statementPaymentInputSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "INVALID_PAYMENT_ACTION", "Thao tác thanh toán không hợp lệ.");
    if (ctx.channel === "browser" && (!invocation.previewId || !invocation.confirmationTokenHash || !invocation.previewPayloadHash)) {
      throw new ApiError(400, "PAYMENT_PREVIEW_REQUIRED", "Thanh toán sao kê cần preview và xác nhận hợp lệ.");
    }
    const command = parsed.data as StatementPaymentInput;
    if (!mongoose.isValidObjectId(cardId) || !mongoose.isValidObjectId(statementId)) throw new ApiError(400, "INVALID_STATEMENT_ID", "Tham chiếu sao kê không hợp lệ.");
    if (!(paidAt instanceof Date) || Number.isNaN(paidAt.valueOf())) throw new ApiError(400, "INVALID_PAYMENT_DATE", "Ngày thanh toán không hợp lệ.");
    const payloadHash = paymentCommandPayloadHash(cardId, statementId, command);
    const spec = {
      operation: "pay_statement",
      idempotencyKey: invocation.idempotencyKey,
      payloadHash,
      endpointOrTool: invocation.endpointOrTool,
      previewId: invocation.previewId,
      confirmationTokenHash: invocation.confirmationTokenHash,
      previewPayloadHash: invocation.previewPayloadHash,
      resource: { type: "statement", cardId, statementId, ...(command.action === "REOPEN" ? { correctionType: "STATEMENT_REOPEN", reason: command.reason ?? "" } : {}) },
    } as const;
    const expectedVersion = command.expectedVersion ? new Date(command.expectedVersion) : undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await commandGuardService.execute(ctx, spec, (session) => this.executeOnce(ctx, cardId, statementId, command, paidAt, session, expectedVersion));
      } catch (error) {
        if (attempt === 0 && isPaymentUniqueConflict(error)) continue;
        throw error;
      }
    }
    throw new ApiError(409, "PAYMENT_CONFLICT", "Thanh toán sao kê đang được xử lý.");
  }

  private static async executeOnce(ctx: ServiceContext, cardId: string, statementId: string, input: StatementPaymentInput, paidAt: Date, session: mongoose.ClientSession, expectedVersion?: Date): Promise<Data> {
        const statement = await CardStatementModel.findOne({ _id: statementId, userCardId: cardId, workspaceId: ctx.workspaceId }).session(session).lean() as Data | null;
        if (!statement) throw new ApiError(404, "STATEMENT_NOT_FOUND", "Không tìm thấy kỳ sao kê.");
        if (expectedVersion && versionOf(statement.updatedAt) !== expectedVersion.toISOString()) throw new ApiError(409, "PAYMENT_PREVIEW_STALE", "Preview thanh toán đã cũ; hãy tải lại và xác nhận lại.");
        const transactions = await FinancialTransactionModel.find({ statementId, workspaceId: ctx.workspaceId }).session(session).lean() as Data[];
        const paymentTransactions = transactions.filter((item) => String(item.transactionType) === "STATEMENT_PAYMENT");
        if (paymentTransactions.length > 1) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Kỳ sao kê có nhiều giao dịch thanh toán.");

        const next = nextPaymentState(String(statement.paymentStatus ?? "OPEN"), input.action, input.reason);
        const totals = paymentTotals(transactions);
        if (input.action === "PAID" && String(statement.paymentStatus) === "PAID") {
          if (!paidLedgerIsConsistent(statement, transactions)) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Trạng thái paid không khớp với ledger sao kê.");
          if (paymentTransactions.length === 0 && totals.paymentAmount === 0) {
            return paymentReceiptResult(statement, statementId, input.action);
          }
          if (paymentTransactions.length === 1) {
            const account = await AccountModel.findOne({ _id: paymentTransactions[0]?.accountId, workspaceId: ctx.workspaceId }).session(session).lean();
            if (!account) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Tài khoản của giao dịch thanh toán không còn thuộc workspace.");
            if (input.repaymentAccountId && String(paymentTransactions[0]?.accountId) !== input.repaymentAccountId) throw new ApiError(409, "STATEMENT_ALREADY_SETTLED", "Kỳ sao kê đã được thanh toán bằng tài khoản khác.");
            return paymentReceiptResult(statement, statementId, input.action);
          }
          throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Kỳ sao kê đã paid nhưng thiếu giao dịch thanh toán.");
        }
        if (input.action !== "PAID") {
          if (input.action === "REOPEN" && input.reverseErroneousPayment && paymentTransactions.length > 0) {
            await FinancialTransactionModel.updateMany({ _id: { $in: paymentTransactions.map((item) => item._id) }, workspaceId: ctx.workspaceId, statementId }, { $set: { voidedAt: paidAt, voidReason: input.reason } }, { session });
          }
          const result = await CardStatementModel.findOneAndUpdate(
            { _id: statementId, userCardId: cardId, workspaceId: ctx.workspaceId, ...(input.action === "REOPEN" && input.reason ? { paymentStatus: "PAID" } : { paymentStatus: { $ne: "PAID" } }), ...(expectedVersion ? { updatedAt: expectedVersion } : {}) },
            { $set: { paymentStatus: next, paidAt: null, paidAmount: null } },
            { returnDocument: "after", session },
          ).lean() as Data | null;
          if (!result) throw new ApiError(409, "STATEMENT_PAID_LOCKED", "Không thể chuyển trạng thái sao kê; kiểm tra reason, payment reversal và expectedVersion.");
          return paymentReceiptResult(result, statementId, input.action);
        }

        if (paymentTransactions.length === 1) throw new ApiError(409, "PAYMENT_STATE_CONFLICT", "Kỳ sao kê đã có giao dịch thanh toán nhưng trạng thái chưa được đồng bộ.");
        let paidTotal = totals.paymentAmount;
        if (totals.outstandingAmount > 0) {
          if (!input.repaymentAccountId) throw new ApiError(400, "REPAYMENT_ACCOUNT_REQUIRED", "Cần chọn tài khoản DEBIT/CASH/E_WALLET dùng để trả sao kê.");
          await this.createPaymentTransaction(ctx, statementId, input.repaymentAccountId, totals.outstandingAmount, paidAt, session);
          paidTotal += totals.outstandingAmount;
        }
        const result = await CardStatementModel.findOneAndUpdate(
          { _id: statementId, userCardId: cardId, workspaceId: ctx.workspaceId, paymentStatus: { $ne: "PAID" }, ...(expectedVersion ? { updatedAt: expectedVersion } : {}) },
          { $set: { paymentStatus: "PAID", paidAt, paidAmount: paidTotal } },
          { returnDocument: "after", session },
        ).lean() as Data | null;
        if (!result) throw new ApiError(409, "PAYMENT_CONFLICT", "Kỳ sao kê vừa được thanh toán bởi yêu cầu khác.");
        const output = paymentReceiptResult(result, statementId, input.action);
      return output;
  }

  private static async createPaymentTransaction(ctx: ServiceContext, statementId: string, repaymentAccountId: string, amount: number, paidAt: Date, session: mongoose.ClientSession) {
    const { account, accountType } = await repaymentAccount(ctx, repaymentAccountId, session);
    const impact = calculateFinancialImpact({ accountType, transactionType: "STATEMENT_PAYMENT", amount });
    await FinancialTransactionModel.create([{
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      accountId: account._id,
      statementId: new mongoose.Types.ObjectId(statementId),
      reimbursementForTransactionId: null,
      accountType,
      transactionType: "STATEMENT_PAYMENT",
      ownership: "PERSONAL",
      amount,
      reimbursementExpected: 0,
      refundReceived: 0,
      cashbackReceived: 0,
      categoryId: "OTHER",
      transactionDate: paidAt.toISOString().slice(0, 10),
      note: `Thanh toán sao kê ${statementId}`,
      ...impact,
    }], { session });
  }
}
