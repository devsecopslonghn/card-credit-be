import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import { registerFinancialTransactionRoutes } from "../src/financial-transaction-routes.js";
import { createMcpServer } from "../src/mcp/tools.js";
import { FinancialTransactionService } from "../src/services/financial-transaction-service.js";
import type { AuthRepository } from "../src/auth-repository.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const user = { id: "user-a", email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };
const users = { findUserById: async (id: string) => id === user.id ? user : null } as unknown as AuthRepository;
const cookie = sessionCookie(signSession({ userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId }, secret));
const mcpContext: ServiceContext = { workspaceId: user.workspaceId, userId: user.id, role: user.role, channel: "mcp", correlationId: "transaction-query-test" };

const callMcp = async (args: Record<string, unknown>) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "transaction-query-test", version: "1.0.0" });
  const server = createMcpServer(mcpContext);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name: "list_transactions", arguments: args });
  const content = result.content as Array<{ type?: string; text?: string }>;
  await client.close();
  await server.close();
  const text = content[0]?.text ?? "null";
  let value: unknown = text;
  try { value = JSON.parse(text); } catch { /* MCP errors are plain text. */ }
  return { result, value };
};

test("REST and MCP transaction list adapters pass one canonical bounded query", async (t) => {
  const observed: Array<{ from?: string; to?: string; accountId?: string; categoryId?: string; limit?: number }> = [];
  t.mock.method(FinancialTransactionService, "list", async (_context: ServiceContext, query: { from?: string; to?: string; accountId?: string; categoryId?: string; limit?: number }) => {
    observed.push(query);
    return [];
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinancialTransactionRoutes(app, secret, users);
  const args = { from: "2026-08-01", to: "2026-08-16", accountId: "account-1", categoryId: "food", limit: 20 };
  const rest = await app.inject({ url: "/api/financial-transactions?from=2026-08-01&to=2026-08-16&accountId=%20account-1%20&categoryId=%20food%20&limit=20", headers: { cookie } });
  const mcp = await callMcp(args);
  assert.equal(rest.statusCode, 200);
  assert.deepEqual(rest.json().data, []);
  assert.deepEqual(mcp.value, []);
  assert.deepEqual(observed, [args, args]);
  await app.close();
});

test("REST transaction list rejects invalid ranges and unknown filters before service access", async (t) => {
  const list = t.mock.method(FinancialTransactionService, "list", async () => []);
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinancialTransactionRoutes(app, secret, users);
  for (const query of [
    "?from=2026-02-30&to=2026-03-01",
    "?from=2026-09-01&to=2026-08-31",
    "?from=2026-08-01&ownerId=owner-1",
    "?limit=0",
    "?limit=101",
    "?limit=not-a-number",
  ]) {
    const response = await app.inject({ url: `/api/financial-transactions${query}`, headers: { cookie } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_TRANSACTION_FILTER");
  }
  assert.equal(list.mock.callCount(), 0);
  await app.close();
});

test("MCP transaction list rejects the legacy singular date filter", async (t) => {
  const list = t.mock.method(FinancialTransactionService, "list", async () => []);
  const response = await callMcp({ date: "2026-08-16" });
  assert.equal(response.result.isError, true);
  assert.equal(list.mock.callCount(), 0);
});

test("REST transaction command requires and forwards the idempotency boundary", async (t) => {
  const create = t.mock.method(FinancialTransactionService, "create", async (_context: ServiceContext, _input: Record<string, unknown>, invocation: { idempotencyKey: string; endpointOrTool: string }) => {
    assert.deepEqual(invocation, { idempotencyKey: "transaction-command-1", endpointOrTool: "POST /api/financial-transactions" });
    return { id: "transaction-1" } as never;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinancialTransactionRoutes(app, secret, users);
  const body = { accountId: "account-1", transactionDate: "2026-08-16", amount: 1000 };
  const missing = await app.inject({ method: "POST", url: "/api/financial-transactions", headers: { cookie }, payload: body });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const short = await app.inject({ method: "POST", url: "/api/financial-transactions", headers: { cookie, "idempotency-key": "short" }, payload: body });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const response = await app.inject({ method: "POST", url: "/api/financial-transactions", headers: { cookie, "idempotency-key": " transaction-command-1 " }, payload: body });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().data, { id: "transaction-1" });
  assert.equal(create.mock.callCount(), 1);
  await app.close();
});

test("REST transaction update/delete require idempotency and delegate canonical commands", async (t) => {
  const update = t.mock.method(FinancialTransactionService, "update", async (_context: ServiceContext, id: string, input: Record<string, unknown>, invocation: { idempotencyKey: string; endpointOrTool: string }) => {
    assert.equal(id, "transaction-1");
    assert.deepEqual(input, { note: "updated" });
    assert.deepEqual(invocation, { idempotencyKey: "transaction-update-1", endpointOrTool: "PATCH /api/financial-transactions/:id" });
    return { id } as never;
  });
  const remove = t.mock.method(FinancialTransactionService, "delete", async (_context: ServiceContext, id: string, invocation: { idempotencyKey: string; endpointOrTool: string }) => {
    assert.equal(id, "transaction-1");
    assert.deepEqual(invocation, { idempotencyKey: "transaction-delete-1", endpointOrTool: "DELETE /api/financial-transactions/:id" });
    return { id } as never;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinancialTransactionRoutes(app, secret, users);
  const missing = await app.inject({ method: "PATCH", url: "/api/financial-transactions/transaction-1", headers: { cookie }, payload: { note: "updated" } });
  assert.equal(missing.statusCode, 400);
  const patched = await app.inject({ method: "PATCH", url: "/api/financial-transactions/transaction-1", headers: { cookie, "idempotency-key": " transaction-update-1 " }, payload: { note: "updated" } });
  assert.equal(patched.statusCode, 200);
  const deleted = await app.inject({ method: "DELETE", url: "/api/financial-transactions/transaction-1", headers: { cookie, "idempotency-key": " transaction-delete-1 " } });
  assert.equal(deleted.statusCode, 200);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 1);
  await app.close();
});
