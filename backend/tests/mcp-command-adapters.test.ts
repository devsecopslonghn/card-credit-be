import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/tools.js";
import { canonicalPayloadHash, confirmationTokenHash, type PreviewTokenCodec } from "../src/mcp/preview.js";
import { AccountService } from "../src/services/account-service.js";
import { FinancialTransactionService } from "../src/services/financial-transaction-service.js";
import { StatementPaymentCommandService } from "../src/services/statement-payment-command-service.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import { statementPaymentPreviewSchema, type StatementPaymentInput } from "@card-credit/contracts";
import type { PreviewConfirmationService } from "../src/services/preview-confirmation-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "mcp", correlationId: "mcp-command-test" };
const codec = {
  issue: () => ({ previewId: "00000000-0000-4000-8000-000000000001", confirmationToken: "token", expiresAt: 1, expiresInSeconds: 300 }),
  verify: (token: string) => { assert.equal(token, "token"); return { previewId: "00000000-0000-4000-8000-000000000001" }; },
} as unknown as PreviewTokenCodec;

const call = async (name: string, args: Record<string, unknown>, previewService?: PreviewConfirmationService) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "command-adapter-test", version: "1.0.0" });
  const server = createMcpServer(context, codec, previewService, "write");
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type?: string; text?: string }>;
  await client.close();
  await server.close();
  return JSON.parse(content[0]?.text ?? "null") as unknown;
};

test("MCP account confirm forwards the fixed command invocation", async (t) => {
  const create = t.mock.method(AccountService, "create", async (_ctx: ServiceContext, _payload: Record<string, unknown>, invocation: { idempotencyKey: string; endpointOrTool: string; previewId?: string; confirmationTokenHash?: string }) => {
    assert.deepEqual(invocation, { idempotencyKey: "account-command-1", endpointOrTool: "confirm_create_account", previewId: "00000000-0000-4000-8000-000000000001", confirmationTokenHash: confirmationTokenHash("token"), previewPayloadHash: canonicalPayloadHash({ name: "Cash", type: "CASH", openingBalance: 0 }) });
    return { id: "account-1" } as never;
  });
  const payload = { name: "Cash", type: "CASH", openingBalance: 0 };
  assert.deepEqual(await call("confirm_create_account", { payload, confirmationToken: "token", idempotencyKey: "account-command-1" }), { id: "account-1" });
  assert.equal(create.mock.callCount(), 1);
});

test("MCP transaction batch confirm forwards the fixed command invocation", async (t) => {
  const createBatch = t.mock.method(FinancialTransactionService, "createBatch", async (_ctx: ServiceContext, _payload: Record<string, unknown>, invocation: { idempotencyKey: string; endpointOrTool: string; previewId?: string; confirmationTokenHash?: string }) => {
    assert.deepEqual(invocation, { idempotencyKey: "transaction-command-1", endpointOrTool: "confirm_import_financial_transaction", previewId: "00000000-0000-4000-8000-000000000001", confirmationTokenHash: confirmationTokenHash("token"), previewPayloadHash: canonicalPayloadHash({ items: [{ accountId: "account-1", transactionDate: "2026-08-16", amount: 1000 }] }) });
    return { count: 1, items: [] };
  });
  const payload = { items: [{ accountId: "account-1", transactionDate: "2026-08-16", amount: 1000 }] };
  assert.deepEqual(await call("confirm_import_financial_transaction", { payload, confirmationToken: "token", idempotencyKey: "transaction-command-1" }), { count: 1, items: [] });
  assert.equal(createBatch.mock.callCount(), 1);
});

test("MCP payment preview and confirm use the canonical payment service and exact preview payload", async (t) => {
  const cardId = "507f1f77bcf86cd799439011";
  const statementId = "507f1f77bcf86cd799439021";
  const input = { action: "PAID" as const, repaymentAccountId: "507f1f77bcf86cd799439031" };
  const preview = {
    operation: "pay_statement" as const,
    cardId,
    statementId,
    action: "PAID" as const,
    paymentStatus: "OPEN" as const,
    nextPaymentStatus: "PAID" as const,
    statementAmount: 1000,
    paymentAmount: 0,
    outstandingAmount: 1000,
    amountToPay: 1000,
    repaymentAccountId: input.repaymentAccountId,
    version: "2026-08-16T00:00:00.000Z",
    requiresRepaymentAccount: false,
    warnings: [],
  };
  const paymentPreview = t.mock.method(StatementPaymentCommandService, "preview", async (ctx: ServiceContext, requestedCardId: string, requestedStatementId: string, requestedInput: StatementPaymentInput) => {
    assert.equal(ctx.channel, "mcp");
    assert.equal(requestedCardId, cardId);
    assert.equal(requestedStatementId, statementId);
    assert.deepEqual(requestedInput, input);
    return preview;
  });
  let issuedPayload: unknown;
  const previewService = { issue: async (_ctx: ServiceContext, operation: string, payload: unknown) => { assert.equal(operation, "pay_statement"); issuedPayload = payload; return { previewId: "00000000-0000-4000-8000-000000000001", confirmationToken: "token", expiresAt: Date.parse("2026-08-16T00:05:00.000Z"), expiresInSeconds: 300 }; } } as unknown as PreviewConfirmationService;
  const previewResponse = await call("preview_pay_statement", { cardId, statementId, input }, previewService);
  assert.deepEqual(statementPaymentPreviewSchema.parse(previewResponse), { ...preview, previewId: "00000000-0000-4000-8000-000000000001", confirmationToken: "token", expiresAt: "2026-08-16T00:05:00.000Z" });
  assert.deepEqual(issuedPayload, { cardId, statementId, input: { action: "PAID", repaymentAccountId: input.repaymentAccountId, expectedVersion: preview.version } });
  assert.equal(paymentPreview.mock.callCount(), 1);

  const execute = t.mock.method(StatementPaymentCommandService, "execute", async (_ctx: ServiceContext, requestedCardId: string, requestedStatementId: string, requestedInput: StatementPaymentInput, invocation: { idempotencyKey: string; endpointOrTool: string; previewId?: string; confirmationTokenHash?: string; previewPayloadHash?: string }) => {
    assert.equal(requestedCardId, cardId);
    assert.equal(requestedStatementId, statementId);
    assert.deepEqual(requestedInput, { ...input, expectedVersion: preview.version });
    assert.deepEqual(invocation, { idempotencyKey: "payment-command-1", endpointOrTool: "confirm_pay_statement", previewId: "00000000-0000-4000-8000-000000000001", confirmationTokenHash: confirmationTokenHash("token"), previewPayloadHash: canonicalPayloadHash({ cardId, statementId, input: { action: "PAID", repaymentAccountId: input.repaymentAccountId, expectedVersion: preview.version } }) });
    return { statementId, action: "PAID", paymentStatus: "PAID", paidAt: preview.version, paidAmount: 1000 };
  });
  const statement = { id: statementId, cardId, periodStartDate: "2026-07-12", periodEndDate: "2026-08-11", statementDate: "2026-08-11", paymentDueDate: "2026-08-26", statementDaySnapshot: 11, paymentDueDaysSnapshot: 15, paymentStatus: "PAID", effectivePaymentStatus: "PAID", paidAt: preview.version, paidAmount: 1000, summary: { statementAmount: 1000, paymentAmount: 1000, outstandingAmount: 0, personalSpending: 1000, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 1 } };
  const get = t.mock.method(StatementQueryService, "get", async () => statement);
  const confirmResponse = await call("confirm_pay_statement", { cardId, statementId, input: { ...input, expectedVersion: preview.version }, previewId: "00000000-0000-4000-8000-000000000001", confirmationToken: "token", idempotencyKey: "payment-command-1" });
  assert.deepEqual(confirmResponse, statement);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(get.mock.callCount(), 1);
});

test("MCP REOPEN preview binds reverseErroneousPayment into the confirmation payload", async (t) => {
  const cardId = "507f1f77bcf86cd799439011";
  const statementId = "507f1f77bcf86cd799439021";
  const input = { action: "REOPEN" as const, reason: "Correction: reimbursement was not statement payment", reverseErroneousPayment: true };
  t.mock.method(StatementPaymentCommandService, "preview", async () => ({
    operation: "pay_statement", cardId, statementId, action: "REOPEN", paymentStatus: "PAID", nextPaymentStatus: "OPEN",
    statementAmount: 16_193_000, paymentAmount: 16_193_000, outstandingAmount: 0, amountToPay: 0,
    repaymentAccountId: null, version: "2026-08-20T00:00:00.000Z", requiresRepaymentAccount: false, warnings: [],
  }));
  let issuedPayload: unknown;
  const previewService = { issue: async (_ctx: ServiceContext, operation: string, payload: unknown) => { assert.equal(operation, "pay_statement"); issuedPayload = payload; return { previewId: "00000000-0000-4000-8000-000000000001", confirmationToken: "token", expiresAt: Date.parse("2026-08-20T00:05:00.000Z"), expiresInSeconds: 300 }; } } as unknown as PreviewConfirmationService;
  const response = await call("preview_pay_statement", { cardId, statementId, input }, previewService);
  assert.equal((response as { action: string }).action, "REOPEN");
  assert.deepEqual(issuedPayload, { cardId, statementId, input: { action: "REOPEN", reason: input.reason, reverseErroneousPayment: true, expectedVersion: "2026-08-20T00:00:00.000Z" } });
});
