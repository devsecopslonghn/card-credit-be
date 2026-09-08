import { settleReceivableInputSchema } from "@card-credit/contracts";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { ApiError } from "../errors.js";
import { canonicalPayloadHash, legacyPayloadHash, payloadHashMatches } from "../command-hash.js";
import { McpMutationModel } from "../models/mcp-mutation.js";
import { commandGuardService, type CommandInvocation } from "./command-guard-service.js";
import type { ServiceContext } from "./types/service-context.js";

type Input = { receivableId?: string; transactionId?: string; amount: number; reason: string; expectedVersion?: number };
const sourceFilter = (ctx: ServiceContext, input: Input) => ({
  workspaceId: ctx.workspaceId,
  _id: input.receivableId ?? input.transactionId,
  transactionType: "EXPENSE",
  ownership: "PAID_FOR_OTHER",
});

export class ReceivableRepairService {
  static async preview(ctx: ServiceContext, raw: unknown) {
    const input = settleReceivableInputSchema.parse(raw) as Input;
    const candidates = await FinancialTransactionModel.find(sourceFilter(ctx, input)).lean() as Array<Record<string, unknown>>;
    if (candidates.length !== 1) throw new ApiError(candidates.length ? 409 : 404, candidates.length ? "RECEIVABLE_REFERENCE_AMBIGUOUS" : "RECEIVABLE_NOT_FOUND", candidates.length ? "Receivable reference không xác định duy nhất." : "Không tìm thấy receivable.", { candidates: candidates.map((item) => String(item._id)).join(",") });
    const source = candidates[0]!;
    const status = String(source.receivableStatus ?? "OPEN");
    const expectedVersion = Number(source.receivableVersion ?? 0);
    if (input.expectedVersion !== undefined && input.expectedVersion !== expectedVersion) throw new ApiError(409, "RECEIVABLE_VERSION_CONFLICT", "Receivable đã thay đổi; hãy tạo preview mới.");
    const outstanding = Math.max(0, Number(source.reimbursementExpected ?? source.outstandingReceivable ?? 0) - Number(source.receivableSettledAmount ?? 0));
    if (input.amount !== outstanding) throw new ApiError(409, "RECEIVABLE_AMOUNT_MISMATCH", "Amount phải bằng số phải thu còn lại.", { outstanding: String(outstanding) });
    return { receivableId: String(source._id), beforeStatus: status, afterStatus: "SETTLED", amount: input.amount, expectedVersion, cashDelta: 0, creditDebtDelta: 0, personalSpending: 0, realIncome: 0, operatingCashflow: 0, serviceFee: 0, technicalRepair: true, warnings: [] };
  }

  static async confirm(ctx: ServiceContext, raw: unknown, invocation: CommandInvocation) {
    const input = settleReceivableInputSchema.parse(raw) as Input;
    const operation = "settle_receivable";
    const payloadHash = canonicalPayloadHash(input);
    const legacyHash = legacyPayloadHash(input);
    return commandGuardService.execute(ctx, { operation, idempotencyKey: invocation.idempotencyKey.trim(), payloadHash, endpointOrTool: invocation.endpointOrTool, previewId: invocation.previewId, confirmationTokenHash: invocation.confirmationTokenHash, previewPayloadHash: invocation.previewPayloadHash, resource: { type: "receivable", receivableId: input.receivableId ?? input.transactionId ?? "", amount: input.amount, beforeStatus: "OPEN", afterStatus: "SETTLED", reason: input.reason } }, async (session) => {
      const existing = await McpMutationModel.findOne({ workspaceId: ctx.workspaceId, operation, idempotencyKey: invocation.idempotencyKey.trim() }).session(session).lean();
      if (existing) { if (!payloadHashMatches(existing.payloadHash, payloadHash, legacyHash)) throw new ApiError(409, "IDEMPOTENCY_PAYLOAD_MISMATCH", "Idempotency key đã dùng cho payload khác."); return existing.result; }
      const expectedVersion = input.expectedVersion ?? 0;
      const filter: Record<string, unknown> = { ...sourceFilter(ctx, input), receivableStatus: { $in: [null, "OPEN"] }, $or: [{ receivableVersion: expectedVersion }, ...(expectedVersion === 0 ? [{ receivableVersion: { $exists: false } }] : [])] };
      const updated = await FinancialTransactionModel.findOneAndUpdate(filter, { $set: { receivableStatus: "SETTLED", receivableSettledAmount: input.amount, receivableSettledAt: new Date(), receivableSettlementReason: input.reason }, $inc: { receivableVersion: 1 } }, { new: true, session }).lean();
      if (!updated) throw new ApiError(409, "RECEIVABLE_VERSION_CONFLICT", "Receivable đã thay đổi; hãy tạo preview mới.");
      return { receivableId: String(updated._id), status: "SETTLED", amount: input.amount, cashDelta: 0, creditDebtDelta: 0, financialTransactionCreated: false };
    });
  }
}
