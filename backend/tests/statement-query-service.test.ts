import assert from "node:assert/strict";
import test from "node:test";
import { createStatementQueryService, summarizeStatementTransactions, type StatementReadRepository } from "../src/services/statement-query-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const ctx: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "request-a" };
const cardId = "507f1f77bcf86cd799439011";
const statementId = "507f1f77bcf86cd799439021";
const records = [{ _id: statementId, workspaceId: "workspace-a", userCardId: cardId, periodStartDate: "2026-07-12", periodEndDate: "2026-08-11", statementDate: "2026-08-11", paymentDueDate: "2026-08-26", statementDaySnapshot: 11, paymentDueDaysSnapshot: 15, paymentStatus: "OPEN" }];
const transactions = [
  { _id: "507f1f77bcf86cd799439031", statementId, accountId: "507f1f77bcf86cd799439041", accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", amount: 1_000_000, categoryId: "food", transactionDate: "2026-08-01", creditDebt: 1_000_000, personalSpending: 1_000_000, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, note: "" },
  { _id: "507f1f77bcf86cd799439032", statementId, accountId: "507f1f77bcf86cd799439042", accountType: "DEBIT", transactionType: "STATEMENT_PAYMENT", ownership: "PERSONAL", amount: 400_000, categoryId: "OTHER", transactionDate: "2026-08-20", creditDebt: -400_000, personalSpending: 0, debitCashflow: -400_000, outstandingReceivable: 0, reimbursementReceived: 0, note: "" },
  { _id: "507f1f77bcf86cd799439033", statementId, accountId: "507f1f77bcf86cd799439043", accountType: "CREDIT", transactionType: "REIMBURSEMENT", ownership: "PERSONAL", amount: 100_000, categoryId: "OTHER", transactionDate: "2026-08-21", creditDebt: 0, personalSpending: 0, debitCashflow: 100_000, outstandingReceivable: 0, reimbursementReceived: 100_000, note: "" },
];

const repository = (calls: string[]): StatementReadRepository => ({
  async listStatements(workspaceId, options) { calls.push(`listStatements:${workspaceId}:${options.order}:${options.unpaidOnly ?? false}`); return records; },
  async findStatementById() { calls.push("findStatementById"); return records[0] ?? null; },
  async findStatement() { calls.push("findStatement"); return records[0] ?? null; },
  async findCard() { calls.push("findCard"); return { _id: cardId, workspaceId: "workspace-a" }; },
  async listCards() { calls.push("listCards"); return [{ _id: cardId, workspaceId: "workspace-a" }]; },
  async listTransactions() { calls.push("listTransactions"); return transactions; },
});

test("statement summary uses persisted credit impact and excludes payment from count", () => {
  assert.deepEqual(summarizeStatementTransactions(transactions), {
    statementAmount: 1_000_000, paymentAmount: 400_000, outstandingAmount: 600_000,
    personalSpending: 1_000_000, outstandingReceivable: 0, reimbursementReceived: 100_000, transactionCount: 2,
  });
});

test("statement query batches transactions and scopes parent card", async () => {
  const calls: string[] = [];
  const service = createStatementQueryService(repository(calls));
  const result = await service.list(ctx, { cardId });
  assert.equal(result[0]?.summary.outstandingAmount, 600_000);
  assert.equal(result[0]?.transactions?.length, 3);
  assert.deepEqual(calls, ["findCard", "listStatements:workspace-a:statementDate:false", "listTransactions"]);
});

test("upcoming statements use one batch transaction query and bounded limit", async () => {
  const calls: string[] = [];
  const service = createStatementQueryService(repository(calls));
  const result = await service.upcoming(ctx, 100);
  assert.equal(result[0]?.summary.outstandingAmount, 600_000);
  assert.deepEqual(calls, ["listStatements:workspace-a:paymentDueDate:true", "listCards", "listTransactions"]);
});

test("statement pages use a stable continuation without dropping the next record", async () => {
  const second = { ...records[0], _id: "507f1f77bcf86cd799439022", statementDate: "2026-08-10", paymentDueDate: "2026-08-25" };
  let observed: { limit?: number; cursor?: string } | undefined;
  const service = createStatementQueryService({
    ...repository([]),
    async listStatements(_workspaceId, options) { observed = options; return options.cursor ? [second] : [records[0]!, second]; },
  });
  const page = await service.listPage(ctx, { cardId, limit: 1, includeTransactions: false });
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0]?.id, statementId);
  assert.equal(page.limit, 1);
  assert.ok(page.nextCursor);
  assert.equal(observed?.limit, 2);
  const next = await service.listPage(ctx, { cardId, limit: 1, cursor: page.nextCursor, includeTransactions: false });
  assert.equal(next.data[0]?.id, second._id);
  assert.equal(observed?.cursor, page.nextCursor);
  assert.equal(next.nextCursor, null);
});

test("card-scoped statement reads discard card ids outside the workspace", async () => {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const service = createStatementQueryService({
    ...repository([]),
    async listCards(workspaceId, cardIds) {
      calls.push({ name: "listCards", value: { workspaceId, cardIds } });
      return [{ _id: cardId, workspaceId }];
    },
    async listStatements(workspaceId, options) {
      calls.push({ name: "listStatements", value: { workspaceId, options } });
      return records;
    },
    async listTransactions(workspaceId, statementIds) {
      calls.push({ name: "listTransactions", value: { workspaceId, statementIds } });
      return transactions;
    },
  });
  const result = await service.listForCardIds(ctx, [cardId, "507f1f77bcf86cd799439099"], { unpaidOnly: true, paymentDueDates: ["2026-08-26"], order: "paymentDueDate" });
  assert.equal(result.length, 1);
  assert.deepEqual(calls, [
    { name: "listCards", value: { workspaceId: "workspace-a", cardIds: [cardId, "507f1f77bcf86cd799439099"] } },
    { name: "listStatements", value: { workspaceId: "workspace-a", options: { cardIds: [cardId], unpaidOnly: true, paymentDueDates: ["2026-08-26"], order: "paymentDueDate" } } },
    { name: "listTransactions", value: { workspaceId: "workspace-a", statementIds: [statementId] } },
  ]);
});

test("statement detail fails closed for malformed identifiers", async () => {
  const service = createStatementQueryService(repository([]));
  assert.equal(await service.getById(ctx, "not-an-object-id"), null);
  await assert.rejects(() => service.get(ctx, cardId, "not-an-object-id"), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_STATEMENT_ID");
});
