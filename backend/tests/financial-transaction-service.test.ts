import assert from "node:assert/strict";
import test from "node:test";
import { AccountModel } from "../src/models/account.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { FinancialTransactionService } from "../src/services/financial-transaction-service.js";
import { commandGuardService, type CommandGuardSpec } from "../src/services/command-guard-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "transaction-list-limit-test" };

test("financial transaction list applies the bounded limit before query execution", async (t) => {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const record = {
    _id: "transaction-1",
    accountId: "account-1",
    statementId: null,
    reimbursementForTransactionId: null,
    accountType: "DEBIT",
    transactionType: "EXPENSE",
    ownership: "PERSONAL",
    amount: 1000,
    serviceFeeRate: 0,
    categoryId: "OTHER",
    transactionDate: "2026-08-16",
    note: "",
    personalSpending: 1000,
    debitCashflow: -1000,
    creditDebt: 0,
    outstandingReceivable: 0,
    reimbursementReceived: 0,
  };
  t.mock.method(FinancialTransactionModel, "find", () => {
    const query = {
      sort: (value: unknown) => { calls.push({ name: "sort", value }); return query; },
      limit: (value: unknown) => { calls.push({ name: "limit", value }); return query; },
      lean: async () => [record],
    };
    return query as never;
  });

  const result = await FinancialTransactionService.list(context, { limit: 25 });

  assert.equal(result.length, 1);
  assert.equal(calls.find((call) => call.name === "limit")?.value, 25);
});

test("financial transaction list filters account type through the canonical account reference", async (t) => {
  let observedQuery: Record<string, unknown> | undefined;
  const accountQuery = {
    select: () => accountQuery,
    lean: async () => [{ _id: "cash-account", type: "CASH" }],
  };
  t.mock.method(AccountModel, "find", (query: Record<string, unknown>) => {
    assert.deepEqual(query, { workspaceId: context.workspaceId, type: "CASH" });
    return accountQuery as never;
  });
  t.mock.method(FinancialTransactionModel, "find", (query: Record<string, unknown>) => {
    observedQuery = query;
    const chain = {
      sort: () => chain,
      limit: () => chain,
      lean: async () => [],
    };
    return chain as never;
  });

  await FinancialTransactionService.list(context, { accountType: "CASH", transactionType: "EXPENSE", ownership: "PERSONAL" });

  assert.deepEqual(observedQuery, {
    workspaceId: context.workspaceId,
    accountId: { $in: ["cash-account"] },
    transactionType: "EXPENSE",
    ownership: "PERSONAL",
  });
});

test("financial transaction create persists the calculated service fee rate", async (t) => {
  const accountId = "507f1f77bcf86cd799439011";
  const cardId = "507f1f77bcf86cd799439012";
  const statementId = "507f1f77bcf86cd799439013";
  const account = { _id: accountId, workspaceId: context.workspaceId, type: "CREDIT", creditCardId: cardId };
  const card = { _id: cardId, workspaceId: context.workspaceId, active: true, statementDay: 15, paymentDueDays: 15 };
  let created: Record<string, unknown> | undefined;

  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: CommandGuardSpec, work: (session: never) => Promise<unknown>) => work({} as never));
  t.mock.method(AccountModel, "findOne", () => ({ session: () => ({ lean: async () => account }) }) as never);
  t.mock.method(CreditCardModel, "findOne", () => ({ session: () => ({ lean: async () => card }) }) as never);
  t.mock.method(CardStatementModel, "findOneAndUpdate", () => ({ lean: async () => ({ _id: statementId }) }) as never);
  t.mock.method(FinancialTransactionModel, "create", async (documents: unknown) => {
    created = (documents as Array<Record<string, unknown>>)[0];
    return [{ ...created, _id: "transaction-1" }] as never;
  });

  await FinancialTransactionService.create(context, {
    accountId,
    transactionType: "EXPENSE",
    ownership: "PAID_FOR_OTHER",
    amount: 17_080_000,
    serviceFeeRate: 2.8,
    transactionDate: "2026-09-17",
  }, { idempotencyKey: "service-fee-persist-test", endpointOrTool: "test" });

  assert.equal(created?.serviceFeeRate, 2.8);
  assert.equal(created?.reimbursementExpected, 16_601_760);
  assert.equal(created?.personalSpending, 478_240);
});
