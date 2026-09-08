import { AccountModel } from "../models/account.js";
import { CreditCardModel } from "../models/credit-card.js";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { ApiError } from "../errors.js";
import { idOf, plain } from "../statement-domain.js";
import { accountGroup, type AccountType } from "../financial-domain.js";
import type { ServiceContext } from "./types/service-context.js";
import { McpMutationModel } from "../models/mcp-mutation.js";
import type { AccountDto, CreateAccountInput } from "@card-credit/contracts";
import mongoose from "mongoose";
import { canonicalPayloadHash, legacyPayloadHash, payloadHashMatches } from "../command-hash.js";
import { commandGuardService, type CommandInvocation } from "./command-guard-service.js";
import { StatementQueryService } from "./statement-query-service.js";

const serialize = (value: unknown): AccountDto => {
  const item = plain(value) as Record<string, unknown>;
  return {
    id: idOf(item._id),
    name: String(item.name ?? ""),
    type: item.type as AccountType,
    group: accountGroup(item.type as AccountType),
    currency: "VND",
    active: item.active !== false,
    creditCardId: item.creditCardId ? idOf(item.creditCardId) : null,
    openingBalance: Number(item.openingBalance ?? 0),
    currentBalance: 0,
    currentDebt: 0,
  };
};

export class AccountService {
  static async list(ctx: ServiceContext, options: { includeArchived?: boolean } = {}) {
    const accounts = await AccountModel.find({ workspaceId: ctx.workspaceId, ...(options.includeArchived ? {} : { active: { $ne: false } }) })
      .sort({ active: -1, createdAt: -1 })
      .lean();
    const hasLinkedCreditAccount = accounts.some((account) => String(account.type) === "CREDIT" && account.creditCardId);
    const [balances, statements] = await Promise.all([
      FinancialTransactionModel.aggregate([
        { $match: { workspaceId: ctx.workspaceId } },
        { $group: { _id: "$accountId", debitCashflow: { $sum: "$debitCashflow" }, creditDebt: { $sum: "$creditDebt" }, technicalDelta: { $sum: "$technicalDelta" } } },
      ]),
      hasLinkedCreditAccount ? StatementQueryService.list(ctx, { includeTransactions: false }) : Promise.resolve([]),
    ]);
    const balanceById = new Map(balances.map((item) => [String(item._id), item]));
    const outstandingByCardId = new Map<string, number>();
    for (const statement of statements) {
      const cardId = String(statement.cardId ?? "");
      if (!cardId) continue;
      const outstanding = Number(statement.summary?.outstandingAmount ?? 0);
      outstandingByCardId.set(cardId, (outstandingByCardId.get(cardId) ?? 0) + Math.max(0, outstanding));
    }
    return accounts.map((account): AccountDto => {
      const totals = balanceById.get(String(account._id)) ?? { debitCashflow: 0, creditDebt: 0 };
      const openingBalance = Number(account.openingBalance ?? 0);
      const isLinkedCreditAccount = String(account.type) === "CREDIT" && account.creditCardId;
      return {
        ...serialize(account),
        currentBalance: openingBalance + (String(account.type) === "CREDIT" ? 0 : Number(totals.debitCashflow ?? 0)),
        // Statement payments belong to the repayment account, but their statementId
        // points to the CREDIT account's statement. Use the statement ledger for
        // linked cards so payments reduce the card debt exactly once.
        currentDebt: isLinkedCreditAccount
          ? Math.max(0, openingBalance + (outstandingByCardId.get(String(account.creditCardId)) ?? 0) + Number(totals.technicalDelta ?? 0))
          : Math.max(0, openingBalance + Number(totals.creditDebt ?? 0)),
      };
    });
  }

  private static async createInternal(ctx: ServiceContext, input: CreateAccountInput, session?: mongoose.ClientSession): Promise<AccountDto> {
    const name = input.name.trim();
    if (!name || name.length > 120) {
      throw new ApiError(400, "INVALID_ACCOUNT", "Tên tài khoản không hợp lệ.");
    }
    if (!Number.isSafeInteger(input.openingBalance ?? 0) || (input.openingBalance ?? 0) < 0) {
      throw new ApiError(400, "INVALID_ACCOUNT", "Số dư ban đầu không hợp lệ.");
    }
    if (input.type !== "CREDIT" && input.creditCardId) {
      throw new ApiError(400, "INVALID_ACCOUNT", "Chỉ tài khoản CREDIT mới được liên kết thẻ.");
    }
    if (input.type === "CREDIT" && input.creditCardId) {
      if (!mongoose.isValidObjectId(input.creditCardId)) {
        throw new ApiError(400, "INVALID_CARD_ID", "Tham chiếu thẻ không hợp lệ.");
      }
      const cardQuery = CreditCardModel.findOne({
        _id: input.creditCardId,
        workspaceId: ctx.workspaceId,
        active: { $ne: false },
      });
      const card = await (session ? cardQuery.session(session) : cardQuery).lean();
      if (!card) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    }
    const record = {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      name,
      type: input.type,
      creditCardId: input.creditCardId ?? null,
      openingBalance: input.openingBalance ?? 0,
    };
    try {
      const account = session
        ? (await AccountModel.create([record], { session }))[0]
        : await AccountModel.create(record);
      if (!account) throw new Error("Account was not created");
      const result = serialize(account);
      return result;
    } catch (error) {
      if (session) {
        if ((error as { code?: number }).code === 11000) throw new ApiError(409, "ACCOUNT_EXISTS", "Tài khoản đã tồn tại trong workspace.");
        throw error;
      }
      if ((error as { code?: number }).code === 11000) {
        const existing = await AccountModel.findOne({ workspaceId: ctx.workspaceId, name, type: input.type, active: { $ne: false } }).lean();
        if (existing) {
          const result = serialize(existing);
          return result;
        }
        throw new ApiError(409, "ACCOUNT_EXISTS", "Tài khoản đã tồn tại trong workspace.");
      }
      throw error;
    }
  }

  static async create(ctx: ServiceContext, input: CreateAccountInput, invocation: CommandInvocation): Promise<AccountDto> {
    const name = input.name.trim();
    if (!name || name.length > 120) throw new ApiError(400, "INVALID_ACCOUNT", "Tên tài khoản không hợp lệ.");
    if (!Number.isSafeInteger(input.openingBalance ?? 0) || (input.openingBalance ?? 0) < 0) throw new ApiError(400, "INVALID_ACCOUNT", "Số dư ban đầu không hợp lệ.");
    if (input.type !== "CREDIT" && input.creditCardId) throw new ApiError(400, "INVALID_ACCOUNT", "Chỉ tài khoản CREDIT mới được liên kết thẻ.");
    const operation = "create_account";
    const payloadHash = canonicalPayloadHash(input);
    const legacyHash = legacyPayloadHash(input);
    const idempotencyKey = invocation.idempotencyKey.trim();
    return commandGuardService.execute(ctx, {
      operation,
      idempotencyKey,
      payloadHash,
      endpointOrTool: invocation.endpointOrTool,
      previewId: invocation.previewId,
      confirmationTokenHash: invocation.confirmationTokenHash,
      previewPayloadHash: invocation.previewPayloadHash,
      resource: { type: "account" },
    }, async (session) => {
      const existingMutation = await McpMutationModel.findOne({ workspaceId: ctx.workspaceId, operation, idempotencyKey }).session(session).lean();
      if (existingMutation) {
        if (!payloadHashMatches(existingMutation.payloadHash, payloadHash, legacyHash)) throw new ApiError(409, "IDEMPOTENCY_PAYLOAD_MISMATCH", "Idempotency key đã dùng cho payload khác.");
        return existingMutation.result as AccountDto;
      }
      return this.createInternal(ctx, input, session);
    });
  }

  static async previewMerge(ctx: ServiceContext, input: { sourceAccountIds: string[]; targetAccountId?: string; targetName?: string; targetType?: AccountType; keepTargetAsCash?: boolean; expectedVersion?: number }) {
    const ids = [...new Set(input.sourceAccountIds)];
    if (ids.some((id) => !mongoose.isValidObjectId(id)) || (input.targetAccountId && !mongoose.isValidObjectId(input.targetAccountId))) throw new ApiError(400, "INVALID_ACCOUNT_ID", "Account ID không hợp lệ.");
    if (input.targetAccountId && ids.includes(input.targetAccountId)) throw new ApiError(409, "ACCOUNT_TARGET_SOURCE_SAME", "Target không được là source.");
    const accounts = await AccountModel.find({ workspaceId: ctx.workspaceId, _id: { $in: [...ids, ...(input.targetAccountId ? [input.targetAccountId] : [])] } }).lean();
    const target = input.targetAccountId ? accounts.find((a) => String(a._id) === input.targetAccountId) : ({ _id: "NEW", workspaceId: ctx.workspaceId, type: input.keepTargetAsCash ? "CASH" : (input.targetType ?? "CASH"), currency: "VND", openingBalance: 0, active: true } as Record<string, unknown>);
    const sources = accounts.filter((a) => ids.includes(String(a._id)));
    if (sources.length !== ids.length || (!target && !input.targetName)) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy account trong workspace.");
    if (!target) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy target account.");
    if (sources.some((a) => a.active === false) || target.active === false) throw new ApiError(409, "ACCOUNT_ARCHIVED", "Không thể merge account archived.");
    if (sources.some((a) => a.type === "CREDIT" || a.creditCardId) || target.type === "CREDIT" || target.creditCardId) throw new ApiError(409, "INVALID_MERGE_ACCOUNT", "Merge chỉ hỗ trợ REAL_MONEY không liên kết card.");
    const all = [target, ...sources];
    if (new Set(all.map((a) => String(a.currency ?? "VND"))).size !== 1 || new Set(all.map((a) => String(a.workspaceId))).size !== 1) throw new ApiError(409, "ACCOUNT_SCOPE_MISMATCH", "Currency/workspace không đồng nhất.");
    const idsForBalance = all.filter((a) => String(a._id) !== "NEW").map((a) => a._id);
    const rows = await FinancialTransactionModel.aggregate([{ $match: { workspaceId: ctx.workspaceId, accountId: { $in: idsForBalance } } }, { $group: { _id: "$accountId", cashflow: { $sum: "$debitCashflow" }, count: { $sum: 1 } } }]);
    const by = new Map(rows.map((r) => [String(r._id), r]));
    const balance = (a: Record<string, unknown>) => Number(a.openingBalance ?? 0) + Number(by.get(String(a._id))?.cashflow ?? 0);
    const sourceOpeningBalance = sources.reduce((n, a) => n + Number(a.openingBalance ?? 0), 0);
    const sourceBalance = sources.reduce((n, a) => n + balance(a), 0); const targetBalance = balance(target);
    return { sourceAccountIds: ids, targetAccountId: String(target._id), sourceOpeningBalance, transactionCount: rows.reduce((n, r) => n + Number(r.count), 0), before: { sourceBalance, targetBalance, totalBalance: sourceBalance + targetBalance }, after: { targetBalance: sourceBalance + targetBalance, totalBalance: sourceBalance + targetBalance }, warnings: ["Source accounts sẽ được archive; openingBalance được chuyển vào target, không tạo income/cashflow."] };
  }

  static async merge(ctx: ServiceContext, input: { sourceAccountIds: string[]; targetAccountId?: string; targetName?: string; targetType?: AccountType; keepTargetAsCash?: boolean; expectedVersion?: number }, invocation: CommandInvocation) {
    // MCP adapters may construct an object with optional keys explicitly set to
    // undefined. canonicalPayloadHash intentionally rejects undefined values;
    // normalize the already-schema-validated command so preview and confirm use
    // the same canonical payload without weakening validation.
    const normalizedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as typeof input;
    const payloadHash = canonicalPayloadHash(normalizedInput);
    const auditPreview = await this.previewMerge(ctx, input);
    return commandGuardService.execute(ctx, { operation: "merge_accounts", idempotencyKey: invocation.idempotencyKey, payloadHash, endpointOrTool: invocation.endpointOrTool, previewId: invocation.previewId, confirmationTokenHash: invocation.confirmationTokenHash, previewPayloadHash: invocation.previewPayloadHash, resource: { type: "account", accountId: input.targetAccountId ?? "new", sourceAccountIds: input.sourceAccountIds.join(","), transactionCount: auditPreview.transactionCount, beforeBalance: auditPreview.before.totalBalance, afterBalance: auditPreview.after.totalBalance } }, async (session) => {
      const preview = await this.previewMerge(ctx, input);
      let targetAccountId = input.targetAccountId;
      if (!targetAccountId) {
        if (!input.targetName) throw new ApiError(400, "INVALID_ACCOUNT", "Cần targetAccountId hoặc targetName.");
        const created = await this.createInternal(ctx, { name: input.targetName, type: input.keepTargetAsCash ? "CASH" : (input.targetType ?? "CASH"), openingBalance: 0 }, session);
        targetAccountId = created.id;
      }
      const versionFilter = input.expectedVersion === undefined ? {} : { version: input.expectedVersion };
      const target = await AccountModel.findOneAndUpdate({ _id: targetAccountId, workspaceId: ctx.workspaceId, active: { $ne: false }, ...versionFilter }, { $inc: { version: 1, openingBalance: auditPreview.sourceOpeningBalance } }, { new: true, session }).lean();
      if (!target) throw new ApiError(409, "ACCOUNT_VERSION_CONFLICT", "Account đã thay đổi; hãy preview lại.");
      const moved = await FinancialTransactionModel.updateMany({ workspaceId: ctx.workspaceId, accountId: { $in: input.sourceAccountIds } }, { $set: { accountId: targetAccountId, accountType: target.type } }, { session });
      await AccountModel.updateMany({ workspaceId: ctx.workspaceId, _id: { $in: input.sourceAccountIds }, active: { $ne: false } }, { $set: { active: false, archivedAt: new Date(), openingBalance: 0 }, $inc: { version: 1 } }, { session });
      return { ...preview, transactionCount: Number(moved.modifiedCount ?? preview.transactionCount), targetAccountId };
    });
  }
}
