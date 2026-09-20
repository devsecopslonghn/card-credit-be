import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CardService } from "../services/card-service.js";
import { CardQueryService } from "../services/card-query-service.js";
import { CardReadFacade } from "../services/card-read-facade.js";
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
import { MCP_OPERATION, mcpToolMetadata, type McpToolName, type McpWriterMode } from "./manifest.js";
import { ApiError } from "../errors.js";
import { paymentPreviewPayload } from "../payment-contract.js";
import { ReceivableRepairService } from "../services/receivable-repair-service.js";
import { settleReceivableInputSchema } from "@card-credit/contracts";

type McpMeta = { count?: number; limit?: number; nextCursor?: string | null; asOf?: string; warnings?: string[] };

const json = (value: unknown, metadata: McpMeta = {}) => {
  const envelope = {
    data: value,
    meta: {
      ...(Array.isArray(value) ? { count: value.length } : {}),
      asOf: new Date().toISOString(),
      ...metadata,
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
};

type ContextProvider = ServiceContext | (() => Promise<ServiceContext>);
type ReportQuery = { from?: string; to?: string; cardId?: string; owner?: string; year?: string; month?: string };

const binding = (context: ServiceContext): PreviewBinding => ({ workspaceId: context.workspaceId, userId: context.userId, channel: context.channel });

export const registerMcpTools = (server: McpServer, ctx: ContextProvider, previewCodec?: PreviewTokenCodec, previewService: PreviewConfirmationService = previewConfirmationService, writerMode: McpWriterMode = "read") => {
  const invocationContext = async () => {
    const base = typeof ctx === "function" ? await ctx() : ctx;
    return { ...base, correlationId: randomUUID() };
  };
  const runQuery = async <T>(tool: McpToolName, work: (context: ServiceContext) => Promise<T>) => {
    const context = await invocationContext();
    const startedAt = performance.now();
    try {
      return await work(context);
    } finally {
      if (process.env.MCP_QUERY_TRACE === "1") {
        console.info(JSON.stringify({ event: "mcp.query", tool, workspaceId: context.workspaceId, userId: context.userId, durationMs: Math.round(performance.now() - startedAt) }));
      }
    }
  };
  const codec = () => previewCodec ?? createPreviewTokenCodec({ secret: process.env.MCP_PREVIEW_SECRET?.trim() ?? "" });
  server.registerTool("get_statement_summary", mcpToolMetadata("get_statement_summary"), async ({ statementId }: { statementId: string }) => {
    const statement = await runQuery("get_statement_summary", (context) => StatementQueryService.getById(context, statementId));
    if (!statement) throw new ApiError(404, "STATEMENT_NOT_FOUND", "Không tìm thấy sao kê trong workspace MCP hiện tại.");
    return json(statement);
  });
  server.registerTool("list_transactions", mcpToolMetadata("list_transactions"), async (filters: FinancialTransactionListQuery) => {
    const query = financialTransactionListQuerySchema.parse(filters ?? {});
    return json(await runQuery("list_transactions", (context) => FinancialTransactionService.list(context, query)));
  });
  server.registerTool("get_monthly_cash_flow", mcpToolMetadata("get_monthly_cash_flow"), async ({ period, cardId }: { period?: string; cardId?: string }) => json(await runQuery("get_monthly_cash_flow", (context) => CashFlowQueryService.list(context, { period, cardId }))));
  server.registerTool("compare_cards", mcpToolMetadata("compare_cards"), async ({ limit }: { limit?: number }) => json(await runQuery("compare_cards", (context) => CardService.compare(context, limit))));
  server.registerTool("find_cards", mcpToolMetadata("find_cards"), async ({ query, owner, limit }: { query?: string; owner?: string; limit?: number }) => json(await runQuery("find_cards", (context) => CardReadFacade.findCards(context, { query, owner, limit }))));
  server.registerTool("list_statements", mcpToolMetadata("list_statements"), async ({ cardId, status = "ALL", from, to, order = "statementDate", limit = 20, cursor }: { cardId?: string; status?: "ALL" | "UNPAID" | "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE"; from?: string; to?: string; order?: "statementDate" | "paymentDueDate"; limit?: number; cursor?: string }) => {
    const page = await runQuery("list_statements", (context) => CardReadFacade.listStatements(context, {
      ...(cardId ? { cardId } : {}),
      ...(status === "UNPAID" ? { unpaidOnly: true } : {}),
      ...(status && status !== "ALL" && status !== "UNPAID" ? { paymentStatus: status } : {}),
      ...(from ? { statementDateFrom: from } : {}),
      ...(to ? { statementDateTo: to } : {}),
      order,
      limit,
      ...(cursor ? { cursor } : {}),
      includeTransactions: false,
    }));
    return json(page.data, { count: page.data.length, limit: page.limit, nextCursor: page.nextCursor });
  });
  server.registerTool("list_duplicate_cards", mcpToolMetadata("list_duplicate_cards"), async ({ limit }: { limit?: number }) => json(await runQuery("list_duplicate_cards", (context) => CardQueryService.listDuplicates(context, limit))));
  server.registerTool("list_card_fee_payments", mcpToolMetadata("list_card_fee_payments"), async ({ cardId, limit }: { cardId: string; limit?: number }) => json(await runQuery("list_card_fee_payments", (context) => FeeQueryService.listCardPayments(context, cardId, limit))));
  server.registerTool("list_fee_center", mcpToolMetadata("list_fee_center"), async ({ cardId, category, limit }: { cardId?: string; category?: FeeCategory; limit?: number }) => json(await runQuery("list_fee_center", (context) => FeeQueryService.listCenter(context, { ...(cardId ? { cardId } : {}), ...(category ? { category } : {}) }, limit))));
  server.registerTool("list_monthly_cashbacks", mcpToolMetadata("list_monthly_cashbacks"), async ({ cardId, year }: { cardId: string; year: string }) => json(await runQuery("list_monthly_cashbacks", (context) => MonthlyCashbackQueryService.list(context, cardId, year))));
  server.registerTool("list_upcoming_statements", mcpToolMetadata("list_upcoming_statements"), async ({ limit = 20, cursor }: { limit?: number; cursor?: string }) => {
    const page = await runQuery("list_upcoming_statements", (context) => CardReadFacade.listStatements(context, { unpaidOnly: true, order: "paymentDueDate", limit, ...(cursor ? { cursor } : {}), includeTransactions: false }));
    return json(page.data, { count: page.data.length, limit: page.limit, nextCursor: page.nextCursor });
  });
  server.registerTool("get_personal_finance_summary", mcpToolMetadata("get_personal_finance_summary"), async (input: { from?: string; to?: string; cardId?: string; owner?: string; year?: string; month?: string }) => {
    const query = reportQuerySchema.parse(input ?? {}) as ReportQuery;
    const range = resolveReportDateRange(query) as { from: string; to: string };
    const filters = {
      ...(query.cardId ? { cardId: query.cardId } : {}),
      ...(query.owner ? { owner: query.owner } : {}),
    };
    return json(await runQuery("get_personal_finance_summary", (context) => FinancialReportService.summary(context, range, Object.keys(filters).length ? filters : undefined)));
  });
  if (writerMode === "write") {
    server.registerTool("preview_import_financial_transaction", mcpToolMetadata("preview_import_financial_transaction"), async (payload: CreateFinancialTransactionBatchInput) => {
      const context = await invocationContext();
      const normalized = await FinancialTransactionService.preview(context, payload);
      const confirmationPayload = payload;
      const metadata = await previewService.issue(context, MCP_OPERATION.importFinancialTransactionBatch, confirmationPayload, codec());
      return json({
        operation: MCP_OPERATION.importFinancialTransactionBatch,
        payload: confirmationPayload,
        preview: normalized.items.map((item) => {
          const isPaidForOtherExpense = item.transactionType === "EXPENSE" && item.ownership === "PAID_FOR_OTHER";
          return {
            amount: item.amount,
            direction: item.direction,
            targetMetric: item.targetMetric,
            beforeBalance: item.balanceBefore,
            afterBalance: item.balanceAfter,
            balanceDelta: item.balanceDelta,
            beforeDebt: item.beforeDebt,
            afterDebt: item.afterDebt,
            debtDelta: item.debtDelta,
            serviceFeeRate: item.technicalAdjustment || !isPaidForOtherExpense ? 0 : item.serviceFeeRate ?? 0,
            serviceFee: item.technicalAdjustment || !isPaidForOtherExpense ? 0 : item.amount - Number(item.reimbursementExpected ?? 0),
            reimbursementExpected: item.reimbursementExpected ?? 0,
            technicalAdjustment: item.technicalAdjustment ?? false,
            impact: item.previewImpact,
          };
        }),
        ...metadata,
      });
    });
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
      let verification: ReturnType<PreviewTokenCodec["verify"]>;
      try {
        verification = codec().verify(confirmationToken, MCP_OPERATION.settleReceivable, parsed, binding(context));
      } catch {
        throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới.");
      }
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
