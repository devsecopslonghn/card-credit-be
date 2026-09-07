import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/tools.js";
import { FeeQueryService } from "../src/services/fee-query-service.js";
import { MonthlyCashbackQueryService } from "../src/services/monthly-cashback-query-service.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { CashFlowQueryService } from "../src/services/cash-flow-query-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = {
  workspaceId: "workspace-a",
  userId: "user-a",
  role: "user",
  channel: "mcp",
  correlationId: "mcp-test",
};

const call = async (name: string, args: Record<string, unknown>) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "read-tools-test", version: "1.0.0" });
  const server = createMcpServer(context);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type?: string; text?: string }>;
  await client.close();
  await server.close();
  const text = content[0]?.type === "text" ? content[0].text ?? "" : "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Unexpected MCP text: ${text}`);
  }
};

test("MCP fee and cashback read tools delegate trusted context and canonical DTOs", async (t) => {
  const cardFee = t.mock.method(FeeQueryService, "listCardPayments", async (ctx: ServiceContext, cardId: string) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    assert.equal(ctx.userId, "user-a");
    assert.equal(ctx.channel, "mcp");
    assert.notEqual(ctx.correlationId, "mcp-test");
    assert.equal(cardId, "507f1f77bcf86cd799439011");
    return [{ id: "fee-1", cardId, category: "ANNUAL_CARD_FEE", paymentDate: "2026-08-01", amount: 299000, note: "" }];
  });
  const feeCenter = t.mock.method(FeeQueryService, "listCenter", async (ctx: ServiceContext, options: { cardId?: string; category?: "MANAGEMENT_FEE" }) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    assert.deepEqual(options, { category: "MANAGEMENT_FEE" });
    return [{ id: "fee-2", cardId: "card-orphan", category: "MANAGEMENT_FEE", paymentDate: "2026-08-02", amount: 50000, note: "", card: null }];
  });
  const cashback = t.mock.method(MonthlyCashbackQueryService, "list", async (ctx: ServiceContext, cardId: string, year: string) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    assert.equal(cardId, "507f1f77bcf86cd799439011");
    assert.equal(year, "2026");
    return [{ id: "cb-1", cardId, period: "2026-08", expectedAmount: 100000, actualAmount: null, status: "REJECTED", receivedAt: null, note: "" }];
  });

  assert.deepEqual(await call("list_card_fee_payments", { cardId: "507f1f77bcf86cd799439011" }), [
    { id: "fee-1", cardId: "507f1f77bcf86cd799439011", category: "ANNUAL_CARD_FEE", paymentDate: "2026-08-01", amount: 299000, note: "" },
  ]);
  assert.deepEqual(await call("list_fee_center", { category: "MANAGEMENT_FEE" }), [
    { id: "fee-2", cardId: "card-orphan", category: "MANAGEMENT_FEE", paymentDate: "2026-08-02", amount: 50000, note: "", card: null },
  ]);
  assert.deepEqual(await call("list_monthly_cashbacks", { cardId: "507f1f77bcf86cd799439011", year: "2026" }), [
    { id: "cb-1", cardId: "507f1f77bcf86cd799439011", period: "2026-08", expectedAmount: 100000, actualAmount: null, status: "REJECTED", receivedAt: null, note: "" },
  ]);
  assert.equal(cardFee.mock.callCount(), 1);
  assert.equal(feeCenter.mock.callCount(), 1);
  assert.equal(cashback.mock.callCount(), 1);
});

test("MCP duplicate-card read tool delegates trusted context and canonical groups", async (t) => {
  const duplicates = t.mock.method(CardQueryService, "listDuplicates", async (ctx: ServiceContext) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    assert.equal(ctx.userId, "user-a");
    assert.equal(ctx.channel, "mcp");
    assert.notEqual(ctx.correlationId, "mcp-test");
    return [{
      fingerprint: "workspace-a::preset-1::Alice",
      presetId: "preset-1",
      normalizedOwner: "Alice",
      reason: "Same workspace, catalog preset and normalized owner.",
      cards: [{ id: "card-1", presetId: "preset-1", owner: "Alice", status: "ACTIVE", displayName: "Card 1" }],
    }];
  });

  assert.deepEqual(await call("list_duplicate_cards", {}), [{
    fingerprint: "workspace-a::preset-1::Alice",
    presetId: "preset-1",
    normalizedOwner: "Alice",
    reason: "Same workspace, catalog preset and normalized owner.",
    cards: [{ id: "card-1", presetId: "preset-1", owner: "Alice", status: "ACTIVE", displayName: "Card 1" }],
  }]);
  assert.equal(duplicates.mock.callCount(), 1);
});

test("MCP monthly cash-flow read tool delegates trusted context and canonical response", async (t) => {
  const cashFlow = t.mock.method(CashFlowQueryService, "list", async (ctx: ServiceContext, options: { period?: string; cardId?: string }) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    assert.equal(ctx.channel, "mcp");
    assert.notEqual(ctx.correlationId, "mcp-test");
    assert.deepEqual(options, { period: "2026-08", cardId: "507f1f77bcf86cd799439011" });
    return { period: "2026-08", data: [{ cardId: "507f1f77bcf86cd799439011", period: "2026-08", totalOut: 100, totalIn: 25, statementPayments: 100, actualFees: 10, partnerReturns: 25, bankCashbackActual: 5, netResult: -75, card: { id: "507f1f77bcf86cd799439011", providerName: "Bank", displayName: "Visa", owner: "Tôi" } }] };
  });
  assert.deepEqual(await call("get_monthly_cash_flow", { period: "2026-08", cardId: "507f1f77bcf86cd799439011" }), {
    period: "2026-08",
    data: [{ cardId: "507f1f77bcf86cd799439011", period: "2026-08", totalOut: 100, totalIn: 25, statementPayments: 100, actualFees: 10, partnerReturns: 25, bankCashbackActual: 5, netResult: -75, card: { id: "507f1f77bcf86cd799439011", providerName: "Bank", displayName: "Visa", owner: "Tôi" } }],
  });
  assert.equal(cashFlow.mock.callCount(), 1);
});

test("MCP read tool schemas reject tenant fields and malformed year", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "schema-test", version: "1.0.0" });
  const server = createMcpServer(context);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tenantInput = await client.callTool({ name: "list_card_fee_payments", arguments: { cardId: "card-1", workspaceId: "workspace-b" } });
  assert.equal(tenantInput.isError, true);
  const malformedYear = await client.callTool({ name: "list_monthly_cashbacks", arguments: { cardId: "card-1", year: "26" } });
  assert.equal(malformedYear.isError, true);
  const malformedPeriod = await client.callTool({ name: "get_monthly_cash_flow", arguments: { period: "2026-13" } });
  assert.equal(malformedPeriod.isError, true);
  const malformedCardId = await client.callTool({ name: "get_monthly_cash_flow", arguments: { cardId: "not-an-object-id" } });
  assert.equal(malformedCardId.isError, true);
  const reversedReportRange = await client.callTool({ name: "get_personal_finance_summary", arguments: { from: "2026-09-01", to: "2026-08-31" } });
  assert.equal(reversedReportRange.isError, true);
  const invalidReportDate = await client.callTool({ name: "get_personal_finance_summary", arguments: { from: "2026-02-30", to: "2026-03-01" } });
  assert.equal(invalidReportDate.isError, true);
  await client.close();
  await server.close();
});
