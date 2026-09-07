import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  cardDuplicateGroupListSchema,
  feeCenterRecordListSchema,
  monthlyCashbackListSchema,
  monthlyCashFlowResponseSchema,
} from "@card-credit/contracts";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import { registerCardRoutes } from "../src/card-routes.js";
import { registerFeeCenterRoutes } from "../src/fee-center-routes.js";
import { registerMonthlyCardCashbackRoutes } from "../src/monthly-card-cashback-routes.js";
import { registerCashFlowRoutes } from "../src/cash-flow-routes.js";
import { createMcpServer } from "../src/mcp/tools.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { CashFlowQueryService } from "../src/services/cash-flow-query-service.js";
import { FeeQueryService } from "../src/services/fee-query-service.js";
import { MonthlyCashbackQueryService } from "../src/services/monthly-cashback-query-service.js";
import { StatementPaymentCommandService } from "../src/services/statement-payment-command-service.js";
import { registerTransactionRoutes } from "../src/transaction-routes.js";
import { statementPaymentPreviewSchema } from "@card-credit/contracts";
import type { PreviewConfirmationService } from "../src/services/preview-confirmation-service.js";
import type { PreviewTokenCodec } from "../src/mcp/preview.js";
import type { ServiceContext } from "../src/services/types/service-context.js";
import type { AuthRepository } from "../src/auth-repository.js";

const secret = "01234567890123456789012345678901";
const cardId = "507f1f77bcf86cd799439011";
const user = { id: "user-a", email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };
const users = { findUserById: async (id: string) => id === user.id ? user : null };
const fullUsers = users as unknown as AuthRepository;
const browserCookie = sessionCookie(signSession({ userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId }, secret));
const mcpContext: ServiceContext = { workspaceId: user.workspaceId, userId: user.id, role: user.role, channel: "mcp", correlationId: "parity-test" };

const callMcp = async (name: string, args: Record<string, unknown>) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "parity-test", version: "1.0.0" });
  const server = createMcpServer(mcpContext);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type?: string; text?: string }>;
  await client.close();
  await server.close();
  return JSON.parse(content[0]?.text ?? "null") as unknown;
};

const card = (id: string) => ({
  id, presetId: "preset-a", providerCode: "BANK", providerName: "Bank", displayName: "Visa", network: "Visa", legacy: false,
  owner: "Tôi", imageUrl: null, annualFee: null, targetSpendForWaiver: null, annualFeeWaiverTarget: null,
  statementDay: null, paymentDueDays: null, cashbackCapAmount: null, cashbackCapPeriod: null, active: true,
  reminderEnabled: true, reminderDaysBefore: [], reminderTimezone: null, reminderTime: null, statementDate: null,
  paymentDueDate: null, amountDueThisMonth: null, isPaidThisMonth: null, monthlyData: [],
});

test("REST and MCP cash-flow adapters parse to the same shared DTO", async (t) => {
  const fixture = { period: "2026-08", data: [{ cardId, period: "2026-08", totalOut: 100, totalIn: 25, statementPayments: 100, actualFees: 10, partnerReturns: 25, bankCashbackActual: 5, netResult: -75, card: { id: cardId, providerName: "Bank", displayName: "Visa", owner: "Tôi" } }] };
  const service = t.mock.method(CashFlowQueryService, "list", async (ctx: ServiceContext, options: { period?: string; cardId?: string }) => {
    assert.equal(ctx.workspaceId, user.workspaceId);
    assert.deepEqual(options, { period: "2026-08", cardId });
    return fixture;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerCashFlowRoutes(app, secret, users);
  const rest = await app.inject({ url: `/api/cash-flow/monthly?period=2026-08&cardId=${cardId}`, headers: { cookie: browserCookie } });
  const mcp = await callMcp("get_monthly_cash_flow", { period: "2026-08", cardId });
  assert.deepEqual(monthlyCashFlowResponseSchema.parse(rest.json()), monthlyCashFlowResponseSchema.parse(mcp));
  assert.equal(service.mock.callCount(), 2);
  await app.close();
});

test("REST and MCP duplicate-card adapters parse to the same shared DTO", async (t) => {
  const fixture = [{ fingerprint: "workspace-a::preset-a::Tôi", presetId: "preset-a", normalizedOwner: "Tôi", reason: "Same workspace, catalog preset and normalized owner.", cards: [card(cardId), card("507f1f77bcf86cd799439012")] }];
  const service = t.mock.method(CardQueryService, "listDuplicates", async (ctx: ServiceContext) => {
    assert.equal(ctx.workspaceId, user.workspaceId);
    return fixture;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerCardRoutes(app, secret, fullUsers);
  const rest = await app.inject({ url: "/api/cards/duplicates", headers: { cookie: browserCookie } });
  const restInput = rest.json().data.map((group: Record<string, unknown>) => ({ ...group, cards: (group.cards as Array<Record<string, unknown>>).map((item) => ({ ...item, id: item._id })) }));
  const mcp = await callMcp("list_duplicate_cards", {});
  assert.deepEqual(cardDuplicateGroupListSchema.parse(restInput), cardDuplicateGroupListSchema.parse(mcp));
  assert.equal(service.mock.callCount(), 2);
  await app.close();
});

test("REST and MCP fee, Fee Center and cashback adapters parse to the same DTOs", async (t) => {
  const payment = { id: "fee-1", cardId, category: "ANNUAL_CARD_FEE" as const, paymentDate: "2026-08-01", amount: 299000, note: "" };
  const center = { ...payment, card: { id: cardId, providerName: "Bank", displayName: "Visa", owner: "Tôi" } };
  const cashback = { id: "cashback-1", cardId, period: "2026-08", expectedAmount: 100000, actualAmount: null, status: "REJECTED" as const, receivedAt: null, note: "" };
  const centerService = t.mock.method(FeeQueryService, "listCenter", async (ctx: ServiceContext, options: { cardId?: string; category?: string }) => { assert.equal(ctx.workspaceId, user.workspaceId); assert.deepEqual(options, { category: "MANAGEMENT_FEE" }); return [{ ...center, category: "MANAGEMENT_FEE" as const }]; });
  const cashbackService = t.mock.method(MonthlyCashbackQueryService, "list", async (ctx: ServiceContext, requestedCardId: string, year: string) => { assert.equal(ctx.workspaceId, user.workspaceId); assert.equal(requestedCardId, cardId); assert.equal(year, "2026"); return [cashback]; });
  const app = buildApp({ isReady: () => true }, "silent");
  registerFeeCenterRoutes(app, secret, users);
  registerMonthlyCardCashbackRoutes(app, secret, users);
  const headers = { cookie: browserCookie };
  const restCenter = await app.inject({ url: "/api/fee-center?category=MANAGEMENT_FEE", headers });
  const mcpCenter = await callMcp("list_fee_center", { category: "MANAGEMENT_FEE" });
  assert.deepEqual(feeCenterRecordListSchema.parse(restCenter.json().data), feeCenterRecordListSchema.parse(mcpCenter));
  const restCashback = await app.inject({ url: `/api/cards/${cardId}/monthly-cashbacks?year=2026`, headers });
  const mcpCashback = await callMcp("list_monthly_cashbacks", { cardId, year: "2026" });
  assert.deepEqual(monthlyCashbackListSchema.parse(restCashback.json().data), monthlyCashbackListSchema.parse(mcpCashback));
  assert.equal(centerService.mock.callCount(), 2);
  assert.equal(cashbackService.mock.callCount(), 2);
  await app.close();
});

test("REST and MCP statement payment previews parse to the same canonical DTO", async (t) => {
  const statementId = "507f1f77bcf86cd799439021";
  const fixture = {
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
    repaymentAccountId: "507f1f77bcf86cd799439031",
    version: "2026-08-16T00:00:00.000Z",
    requiresRepaymentAccount: false,
    warnings: [],
  };
  const preview = t.mock.method(StatementPaymentCommandService, "preview", async (ctx: ServiceContext, requestedCardId: string, requestedStatementId: string, input: { action: string; repaymentAccountId?: string }) => {
    assert.equal(ctx.workspaceId, user.workspaceId);
    assert.equal(requestedCardId, cardId);
    assert.equal(requestedStatementId, statementId);
    assert.deepEqual(input, { action: "PAID", repaymentAccountId: fixture.repaymentAccountId });
    return fixture;
  });
  const metadata = { previewId: "00000000-0000-4000-8000-000000000001", confirmationToken: "token", expiresAt: Date.parse("2026-08-16T00:05:00.000Z"), expiresInSeconds: 300 };
  const previewService = { issue: async () => metadata } as unknown as PreviewConfirmationService;
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret, undefined, previewService);
  const rest = await app.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/payment/preview`, headers: { cookie: browserCookie }, payload: { action: "PAID", repaymentAccountId: fixture.repaymentAccountId } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "payment-parity-test", version: "1.0.0" });
  const codec = { issue: () => metadata, verify: () => ({ previewId: metadata.previewId }) } as unknown as PreviewTokenCodec;
  const server = createMcpServer(mcpContext, codec, previewService, "write");
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const mcpResult = await client.callTool({ name: "preview_pay_statement", arguments: { cardId, statementId, input: { action: "PAID", repaymentAccountId: fixture.repaymentAccountId } } });
  const mcpContent = mcpResult.content as Array<{ type?: string; text?: string }>;
  const mcp = JSON.parse(mcpContent[0]?.text ?? "null");
  assert.deepEqual(statementPaymentPreviewSchema.parse(rest.json().data), statementPaymentPreviewSchema.parse(mcp));
  assert.equal(preview.mock.callCount(), 2);
  await client.close();
  await server.close();
  await app.close();
});
