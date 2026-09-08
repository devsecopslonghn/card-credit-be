import test from "node:test";
import assert from "node:assert/strict";
import { AccountService } from "../src/services/account-service.js";
import { AccountModel } from "../src/models/account.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { commandGuardService } from "../src/services/command-guard-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const sourceId = "507f1f77bcf86cd799439011";
const targetId = "507f1f77bcf86cd799439012";
const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "mcp", correlationId: "merge-test" };
const invocation = { idempotencyKey: "merge-command-1", endpointOrTool: "confirm_merge_accounts" };
const chain = <T>(value: T) => ({ lean: async () => value });

test("merge updates accountId only and preserves ledger identity/impacts", async (t) => {
  const source = { _id: sourceId, workspaceId: context.workspaceId, type: "CASH", currency: "VND", openingBalance: 200, active: true, version: 2 };
  const target = { _id: targetId, workspaceId: context.workspaceId, type: "DEBIT", currency: "VND", openingBalance: 1000, active: true, version: 4 };
  const transactions = [
    { _id: "507f1f77bcf86cd799439021", accountId: sourceId, transactionType: "EXPENSE", amount: 500, debitCashflow: -500, personalSpending: 500, statementId: null, reimbursementForTransactionId: null },
    { _id: "507f1f77bcf86cd799439022", accountId: sourceId, transactionType: "INCOME", amount: 800, debitCashflow: 800, personalSpending: 0, statementId: "statement-1", reimbursementForTransactionId: "507f1f77bcf86cd799439021" },
    { _id: "507f1f77bcf86cd799439023", accountId: sourceId, transactionType: "REIMBURSEMENT", amount: 200, debitCashflow: 200, personalSpending: 0, statementId: null, reimbursementForTransactionId: "507f1f77bcf86cd799439021" },
    { _id: "507f1f77bcf86cd799439024", accountId: sourceId, transactionType: "STATEMENT_PAYMENT", amount: 200, debitCashflow: -200, personalSpending: 0, statementId: "statement-1", reimbursementForTransactionId: null },
  ];
  let transactionFilter: Record<string, unknown> | undefined;
  let targetFilter: Record<string, unknown> | undefined;
  let targetUpdate: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  let archived = false;
  t.mock.method(AccountModel, "find", () => chain([source, target]) as never);
  t.mock.method(FinancialTransactionModel, "aggregate", async () => [
    { _id: sourceId, cashflow: 300, count: 4 }, { _id: targetId, cashflow: 0, count: 0 },
  ] as never);
  t.mock.method(AccountModel, "findOneAndUpdate", (filter: Record<string, unknown>, value: Record<string, unknown>) => { targetFilter = filter; targetUpdate = value; return chain({ ...target, version: 5 }) as never; });
  t.mock.method(FinancialTransactionModel, "updateMany", async (filter: Record<string, unknown>, value: Record<string, unknown>) => { transactionFilter = filter; update = value; return { modifiedCount: transactions.length } as never; });
  t.mock.method(AccountModel, "updateMany", async () => { archived = true; return { modifiedCount: 1 } as never; });
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: unknown, work: (session: unknown) => Promise<unknown>) => work({}));

  const result = await AccountService.merge(context, { sourceAccountIds: [sourceId], targetAccountId: targetId, expectedVersion: 4 }, invocation);
  assert.equal(result.transactionCount, 4);
  assert.equal(result.before.totalBalance, 1500);
  assert.equal(result.after.totalBalance, 1500);
  assert.deepEqual(update, { $set: { accountId: targetId, accountType: "DEBIT" } });
  assert.deepEqual(transactionFilter?.accountId, { $in: [sourceId] });
  assert.deepEqual(targetUpdate, { $inc: { version: 1, openingBalance: 200 } });
  assert.equal(archived, true);
  assert.equal((targetFilter as { version?: number } | undefined)?.version, 4);
  assert.deepEqual(transactions.map((item) => item._id), ["507f1f77bcf86cd799439021", "507f1f77bcf86cd799439022", "507f1f77bcf86cd799439023", "507f1f77bcf86cd799439024"]);
  assert.equal(transactions.reduce((sum, item) => sum + item.personalSpending, 0), 500);
  assert.equal(transactions.filter((item) => item.statementId).length, 2);
  assert.equal(transactions.filter((item) => item.reimbursementForTransactionId).length, 2);
});

test("merge does not archive sources when transaction move fails", async (t) => {
  const source = { _id: sourceId, workspaceId: context.workspaceId, type: "CASH", currency: "VND", openingBalance: 0, active: true, version: 0 };
  const target = { _id: targetId, workspaceId: context.workspaceId, type: "DEBIT", currency: "VND", openingBalance: 0, active: true, version: 0 };
  let archived = false;
  t.mock.method(AccountModel, "find", () => chain([source, target]) as never);
  t.mock.method(FinancialTransactionModel, "aggregate", async () => [] as never);
  t.mock.method(AccountModel, "findOneAndUpdate", () => chain(target) as never);
  t.mock.method(FinancialTransactionModel, "updateMany", async () => { throw new Error("write failed"); });
  t.mock.method(AccountModel, "updateMany", async () => { archived = true; return { modifiedCount: 1 } as never; });
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: unknown, work: (session: unknown) => Promise<unknown>) => work({}));
  await assert.rejects(AccountService.merge(context, { sourceAccountIds: [sourceId], targetAccountId: targetId }, invocation), /write failed/);
  assert.equal(archived, false);
});

test("concurrent merge with stale expectedVersion is rejected before ledger move", async (t) => {
  const source = { _id: sourceId, workspaceId: context.workspaceId, type: "CASH", currency: "VND", openingBalance: 0, active: true, version: 0 };
  const target = { _id: targetId, workspaceId: context.workspaceId, type: "DEBIT", currency: "VND", openingBalance: 0, active: true, version: 0 };
  let targetUpdates = 0;
  let transactionMoves = 0;
  t.mock.method(AccountModel, "find", () => chain([source, target]) as never);
  t.mock.method(FinancialTransactionModel, "aggregate", async () => [] as never);
  t.mock.method(AccountModel, "findOneAndUpdate", () => { targetUpdates += 1; return chain(targetUpdates === 1 ? { ...target, version: 1 } : null) as never; });
  t.mock.method(FinancialTransactionModel, "updateMany", async () => { transactionMoves += 1; return { modifiedCount: 0 } as never; });
  t.mock.method(AccountModel, "updateMany", async () => ({ modifiedCount: 1 }) as never);
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: unknown, work: (session: unknown) => Promise<unknown>) => work({}));
  const first = await AccountService.merge(context, { sourceAccountIds: [sourceId], targetAccountId: targetId, expectedVersion: 0 }, { ...invocation, idempotencyKey: "merge-concurrent-1" });
  assert.equal(first.targetAccountId, targetId);
  await assert.rejects(AccountService.merge(context, { sourceAccountIds: [sourceId], targetAccountId: targetId, expectedVersion: 0 }, { ...invocation, idempotencyKey: "merge-concurrent-2" }), (error: unknown) => (error as { code?: string }).code === "ACCOUNT_VERSION_CONFLICT");
  assert.equal(transactionMoves, 1);
});

test("merge accepts adapter objects containing omitted optional keys as undefined", async (t) => {
  const source = { _id: sourceId, workspaceId: context.workspaceId, type: "CASH", currency: "VND", openingBalance: 0, active: true, version: 0 };
  const target = { _id: targetId, workspaceId: context.workspaceId, type: "DEBIT", currency: "VND", openingBalance: 0, active: true, version: 0 };
  t.mock.method(AccountModel, "find", () => chain([source, target]) as never);
  t.mock.method(FinancialTransactionModel, "aggregate", async () => [] as never);
  t.mock.method(AccountModel, "findOneAndUpdate", () => chain(target) as never);
  t.mock.method(FinancialTransactionModel, "updateMany", async () => ({ modifiedCount: 0 }) as never);
  t.mock.method(AccountModel, "updateMany", async () => ({ modifiedCount: 1 }) as never);
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: unknown, work: (session: unknown) => Promise<unknown>) => work({}));
  await assert.doesNotReject(AccountService.merge(context, { sourceAccountIds: [sourceId], targetAccountId: targetId, targetName: undefined, targetType: undefined, keepTargetAsCash: false, expectedVersion: undefined }, { ...invocation, idempotencyKey: "merge-undefined-1" }));
});
