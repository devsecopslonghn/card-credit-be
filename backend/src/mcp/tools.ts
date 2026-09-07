import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardService } from "../services/card-service.js";
import { CardQueryService } from "../services/card-query-service.js";
import { canonicalPayloadHash, confirmationTokenHash, createPreviewTokenCodec, type PreviewBinding, type PreviewTokenCodec } from "./preview.js";
import { previewConfirmationService, type PreviewConfirmationService } from "../services/preview-confirmation-service.js";
import type { ServiceContext } from "../services/types/service-context.js";
import { FinancialTransactionService, type CreateFinancialTransactionBatchInput } from "../services/financial-transaction-service.js";
import { FinancialReportService } from "../services/financial-report-service.js";
import { StatementQueryService } from "../services/statement-query-service.js";
import { StatementPaymentCommandService } from "../services/statement-payment-command-service.js";
import { AccountService } from "../services/account-service.js";
import { FeeQueryService } from "../services/fee-query-service.js";
import { MonthlyCashbackQueryService } from "../services/monthly-cashback-query-service.js";
import { CashFlowQueryService } from "../services/cash-flow-query-service.js";
import { financialTransactionListQuerySchema, reportQuerySchema, resolveReportDateRange, mergeAccountsInputSchema, type CreateRealMoneyAccountInput, type FeeCategory, type FinancialTransactionListQuery } from "@card-credit/contracts";
import { statementPaymentInputSchema, statementPaymentPreviewSchema, type StatementPaymentInput } from "@card-credit/contracts";
import { randomUUID } from "node:crypto";
import { MCP_OPERATION, mcpToolMetadata, type McpWriterMode } from "./manifest.js";
import { ApiError } from "../errors.js";
import { paymentPreviewPayload } from "../payment-contract.js";
import { ReceivableRepairService } from "../services/receivable-repair-service.js";
import { settleReceivableInputSchema } from "@card-credit/contracts";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

type ContextProvider = ServiceContext | (() => Promise<ServiceContext>);
type ReportQuery = { from?: string; to?: string; cardId?: string; owner?: string; year?: string; month?: string };

const binding = (context: ServiceContext): PreviewBinding => ({ workspaceId: context.workspaceId, userId: context.userId, channel: context.channel });

export const registerMcpTools = (server: McpServer, ctx: ContextProvider, previewCodec?: PreviewTokenCodec, previewService: PreviewConfirmationService = previewConfirmationService, writerMode: McpWriterMode = "read") => {
  const invocationContext = async () => {
    const base = typeof ctx === "function" ? await ctx() : ctx;
    return { ...base, correlationId: randomUUID() };
  };
  const codec = () => previewCodec ?? createPreviewTokenCodec({ secret: process.env.MCP_PREVIEW_SECRET?.trim() ?? "" });
  server.registerTool("get_statement_summary", mcpToolMetadata("get_statement_summary"), async ({ statementId }: { statementId: string }) => json(await StatementQueryService.getById(await invocationContext(), statementId)));
  server.registerTool("list_transactions", mcpToolMetadata("list_transactions"), async (filters: FinancialTransactionListQuery) => {
    const query = financialTransactionListQuerySchema.parse(filters ?? {});
    return json(await FinancialTransactionService.list(await invocationContext(), query));
  });
  server.registerTool("get_monthly_cash_flow", mcpToolMetadata("get_monthly_cash_flow"), async ({ period, cardId }: { period?: string; cardId?: string }) => json(await CashFlowQueryService.list(await invocationContext(), { period, cardId })));
 server.registerTool("compare_cards", mcpToolMetadata("compare_cards"), async ({ limit }: { limit?: number }) => json(await CardService.compare(await invocationContext(), limit)));
  server.registerTool("list_duplicate_cards", mcpToolMetadata("list_duplicate_cards"), async ({ limit }: { limit?: number }) => json(await CardQueryService.listDuplicates(await invocationContext(), limit)));
  server.registerTool("list_card_fee_payments", mcpToolMetadata("list_card_fee_payments"), async ({ cardId, limit }: { cardId: string; limit?: number }) => json(await FeeQueryService.listCardPayments(await invocationContext(), cardId, limit)));
  server.registerTool("list_fee_center", mcpToolMetadata("list_fee_center"), async ({ cardId, category, limit }: { cardId?: string; category?: FeeCategory; limit?: number }) => json(await FeeQueryService.listCenter(await invocationContext(), { ...(cardId ? { cardId } : {}), ...(category ? { category } : {}) }, limit)));
  server.registerTool("list_monthly_cashbacks", mcpToolMetadata("list_monthly_cashbacks"), async ({ cardId, year }: { cardId: string; year: string }) => json(await MonthlyCashbackQueryService.list(await invocationContext(), cardId, year)));
 server.registerTool("list_upcoming_statements", mcpToolMetadata("list_upcoming_statements"), async ({ limit }: { limit: number }) => json(await StatementQueryService.upcoming(await invocationContext(), limit)));
  server.registerTool("get_personal_finance_summary", mcpToolMetadata("get_personal_finance_summary"), async (input: { from?: string; to?: string; cardId?: string; owner?: string; year?: string; month?: string }) => {
    const query = reportQuerySchema.parse(input ?? {}) as ReportQuery;
    const range = resolveReportDateRange(query) as { from: string; to: string };
    const filters = {
      ...(query.cardId ? { cardId: query.cardId } : {}),
      ...(query.owner ? { owner: query.owner } : {}),
    };
    return json(await FinancialReportService.summary(await invocationContext(), range, Object.keys(filters).length ? filters : undefined));
  });
  if (writerMode === "write") {
    server.registerTool("preview_import_financial_transaction", mcpToolMetadata("preview_import_financial_transaction"), async (payload: CreateFinancialTransactionBatchInput) => { const context = await invocationContext(); const normalized = await FinancialTransactionService.preview(context, payload); const confirmationPayload = payload; const metadata = await previewService.issue(context, MCP_OPERATION.importFinancialTransactionBatch, confirmationPayload, codec()); return json({ operation: MCP_OPERATION.importFinancialTransactionBatch, payload: confirmationPayload, preview: normalized.items.map((item) => ({ amount: item.amount, direction: item.direction, targetMetric: item.targetMetric, beforeBalance: item.balanceBefore, afterBalance: item.balanceAfter, balanceDelta: item.balanceDelta, beforeDebt: item.beforeDebt, afterDebt: item.afterDebt, debtDelta: item.debtDelta, serviceFeeRate: item.technicalAdjustment ? 0 : item.serviceFeeRate ?? 0, serviceFee: item.technicalAdjustment ? 0 : item.amount - Number(item.reimbursementExpected ?? 0), reimbursementExpected: item.reimbursementExpected ?? 0, technicalAdjustment: item.technicalAdjustment ?? false, impact: item.previewImpact })), ...metadata }); });
    server.registerTool("confirm_import_financial_transaction", mcpToolMetadata("confirm_import_financial_transaction"), async ({ payload, confirmationToken, idempotencyKey }: { payload: CreateFinancialTransactionBatchInput; confirmationToken: string; idempotencyKey: string }) => { const context = await invocationContext(); const verification = codec().verify(confirmationToken, MCP_OPERATION.importFinancialTransactionBatch, payload, binding(context)); return json(await FinancialTransactionService.createBatch(context, payload, { idempotencyKey, endpointOrTool: "confirm_import_financial_transaction", previewId: verification.previewId, confirmationTokenHash: confirmationTokenHash(confirmationToken), previewPayloadHash: canonicalPayloadHash(payload) })); });
  }
  server.registerTool("list_accounts", mcpToolMetadata("list_accounts"), async ({ includeArchived }: { includeArchived?: boolean } = {}) => json(await AccountService.list(await invocationContext(), { includeArchived })));
  if (writerMode === "write") {
    server.registerTool("preview_merge_accounts", mcpToolMetadata("preview_merge_accounts"), async (payload: unknown) => { const context = await invocationContext(); const parsed = mergeAccountsInputSchema.parse(payload) as { sourceAccountIds: string[]; targetAccountId?: string; targetName?: string; keepTargetAsCash?: boolean; expectedVersion?: number }; const preview = await AccountService.previewMerge(context, parsed); const metadata = await previewService.issue(context, MCP_OPERATION.mergeAccounts, parsed, codec()); return json({ operation: MCP_OPERATION.mergeAccounts, ...preview, ...metadata }); });
    server.registerTool("confirm_merge_accounts", mcpToolMetadata("confirm_merge_accounts"), async ({ payload, previewId, confirmationToken, idempotencyKey }: { payload: unknown; previewId: string; confirmationToken: string; idempotencyKey: string }) => { const context = await invocationContext(); const parsed = mergeAccountsInputSchema.parse(payload) as { sourceAccountIds: string[]; targetAccountId?: string; targetName?: string; targetType?: "DEBIT" | "CASH" | "E_WALLET"; keepTargetAsCash?: boolean; expectedVersion?: number }; let verification; try { verification = codec().verify(confirmationToken, MCP_OPERATION.mergeAccounts, parsed, binding(context)); } catch { throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới."); } if (verification.previewId !== previewId) throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới."); return json(await AccountService.merge(context, { sourceAccountIds: parsed.sourceAccountIds, targetAccountId: parsed.targetAccountId, targetName: parsed.targetName, targetType: parsed.targetType, keepTargetAsCash: parsed.keepTargetAsCash, expectedVersion: parsed.expectedVersion }, { idempotencyKey, endpointOrTool: "confirm_merge_accounts", previewId, confirmationTokenHash: confirmationTokenHash(confirmationToken), previewPayloadHash: canonicalPayloadHash(parsed) })); });
    server.registerTool("preview_create_account", mcpToolMetadata("preview_create_account"), async (payload: CreateRealMoneyAccountInput) => { const context = await invocationContext(); const metadata = await previewService.issue(context, MCP_OPERATION.createAccount, payload, codec()); return json({ operation: MCP_OPERATION.createAccount, payload, ...metadata }); });
    server.registerTool("confirm_create_account", mcpToolMetadata("confirm_create_account"), async ({ payload, confirmationToken, idempotencyKey }: { payload: CreateRealMoneyAccountInput; confirmationToken: string; idempotencyKey: string }) => { const context = await invocationContext(); const verification = codec().verify(confirmationToken, MCP_OPERATION.createAccount, payload, binding(context)); return json(await AccountService.create(context, payload, { idempotencyKey, endpointOrTool: "confirm_create_account", previewId: verification.previewId, confirmationTokenHash: confirmationTokenHash(confirmationToken), previewPayloadHash: canonicalPayloadHash(payload) })); });
    server.registerTool("preview_pay_statement", mcpToolMetadata("preview_pay_statement"), async ({ cardId, statementId, input }: { cardId: string; statementId: string; input: StatementPaymentInput }) => {
      const context = await invocationContext();
      const parsed = statementPaymentInputSchema.parse(input) as StatementPaymentInput;
      const preview = await StatementPaymentCommandService.preview(context, cardId, statementId, parsed);
      const previewInput: StatementPaymentInput = {
        action: preview.action,
        ...(preview.repaymentAccountId ? { repaymentAccountId: preview.repaymentAccountId } : {}),
        ...(parsed.reason ? { reason: parsed.reason } : {}),
        ...(parsed.reverseErroneousPayment ? { reverseErroneousPayment: true } : {}),
        ...(preview.version ? { expectedVersion: preview.version } : {}),
      };
      const payload = paymentPreviewPayload(cardId, statementId, previewInput);
      const metadata = await previewService.issue(context, MCP_OPERATION.payStatement, payload, codec());
      return json(statementPaymentPreviewSchema.parse({ ...preview, previewId: metadata.previewId, confirmationToken: metadata.confirmationToken, expiresAt: new Date(metadata.expiresAt).toISOString() }));
    });
    server.registerTool("confirm_pay_statement", mcpToolMetadata("confirm_pay_statement"), async ({ cardId, statementId, input, previewId, confirmationToken, idempotencyKey }: { cardId: string; statementId: string; input: StatementPaymentInput; previewId: string; confirmationToken: string; idempotencyKey: string }) => {
      const context = await invocationContext();
      const parsed = statementPaymentInputSchema.parse(input) as StatementPaymentInput;
      let verification: ReturnType<PreviewTokenCodec["verify"]>;
      try {
        verification = codec().verify(confirmationToken, MCP_OPERATION.payStatement, paymentPreviewPayload(cardId, statementId, parsed), binding(context));
      } catch {
        throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới.");
      }
      if (verification.previewId !== previewId) throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới.");
      await StatementPaymentCommandService.execute(context, cardId, statementId, parsed, { idempotencyKey, endpointOrTool: "confirm_pay_statement", previewId, confirmationTokenHash: confirmationTokenHash(confirmationToken), previewPayloadHash: canonicalPayloadHash(paymentPreviewPayload(cardId, statementId, parsed)) });
      return json(await StatementQueryService.get(context, cardId, statementId));
    });
    server.registerTool("preview_settle_receivable", mcpToolMetadata("preview_settle_receivable"), async (payload: unknown) => {
      const context = await invocationContext();
      const parsed = settleReceivableInputSchema.parse(payload);
      const preview = await ReceivableRepairService.preview(context, parsed);
      const metadata = await previewService.issue(context, MCP_OPERATION.settleReceivable, parsed, codec());
      return json({ operation: MCP_OPERATION.settleReceivable, ...preview, ...metadata });
    });
    server.registerTool("confirm_settle_receivable", mcpToolMetadata("confirm_settle_receivable"), async ({ payload, previewId, confirmationToken, idempotencyKey }: { payload: unknown; previewId: string; confirmationToken: string; idempotencyKey: string }) => {
      const context = await invocationContext();
      const parsed = settleReceivableInputSchema.parse(payload);
      const verification = codec().verify(confirmationToken, MCP_OPERATION.settleReceivable, parsed, binding(context));
      if (verification.previewId !== previewId) throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới.");
      return json(await ReceivableRepairService.confirm(context, parsed, { idempotencyKey, endpointOrTool: "confirm_settle_receivable", previewId, confirmationTokenHash: confirmationTokenHash(confirmationToken), previewPayloadHash: canonicalPayloadHash(parsed) }));
    });
  }
};

export const createMcpServer = (ctx: ContextProvider, previewCodec?: PreviewTokenCodec, previewService: PreviewConfirmationService = previewConfirmationService, writerMode: McpWriterMode = "read") => {
  const server = new McpServer({ name: "card-credit", version: "0.1.0" });
  registerMcpTools(server, ctx, previewCodec, previewService, writerMode);
  return server;
};
