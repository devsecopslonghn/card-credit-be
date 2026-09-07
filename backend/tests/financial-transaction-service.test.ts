import assert from "node:assert/strict";
import test from "node:test";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { FinancialTransactionService } from "../src/services/financial-transaction-service.js";
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
