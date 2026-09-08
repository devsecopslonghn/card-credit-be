import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import { derived, statementPeriod, summarize, transactionInput, validDate } from "../src/statement-domain.js";
import { registerTransactionRoutes } from "../src/transaction-routes.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";

const secret = "01234567890123456789012345678901";
const cookie = sessionCookie(signSession({ userId: "user-1", email: "user@example.test", role: "user", workspaceId: "workspace-a" }, secret));

test("statement boundaries clamp short months and transaction totals preserve VND integers", () => {
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2027-02-29"), false);
  assert.deepEqual(statementPeriod("2026-02-01", 31, 15), { periodStartDate: "2026-02-01", periodEndDate: "2026-02-28", statementDate: "2026-02-28", paymentDueDate: "2026-03-15", statementDaySnapshot: 31, paymentDueDaysSnapshot: 15 });
  const input = transactionInput({ transactionDate: "2026-07-11", outcomeAmount: 100_000, incomeInputMode: "RATE", partnerReturnRateBps: 200, cashbackRateBps: 100 });
  assert.equal(input.incomeAmount, 2_000);
  assert.equal(derived({ ...input, cashbackStatus: "PENDING" }).expectedNetProfit, -97_000);
  const summary = summarize([
    { ...input, cashbackStatus: "RECEIVED", actualCashbackAmount: 1_000 },
  ]);
  assert.equal(summary.totalAmountDue, 100_000);
  assert.deepEqual(summary.cashbackCap, {
    capAmount: null,
    unlimited: true,
    cashbackByRate: 1_000,
    eligibleCashback: 1_000,
    actualCashback: 1_000,
    exceededCashback: 0,
    remainingCashback: null,
    capUsedPercent: null,
  });
  assert.equal(summarize([{ ...input }], 5_000).cashbackCap.capUsedPercent, 20);
});

test("transaction input preserves PATCH mode, accepts explicit modes, and rejects invalid modes", () => {
  const base = {
    transactionDate: "2026-07-11",
    outcomeAmount: 100_000,
    incomeAmount: 2_000,
    partnerReturnRateBps: 200,
    cashbackRateBps: 100,
    note: "original",
  };

  assert.equal(
    transactionInput({ note: "updated" }, { ...base, incomeInputMode: "RATE" })
      .incomeInputMode,
    "RATE",
  );
  assert.equal(
    transactionInput({ note: "updated" }, { ...base, incomeInputMode: "AMOUNT" })
      .incomeInputMode,
    "AMOUNT",
  );
  assert.equal(
    transactionInput(
      { incomeInputMode: "RATE" },
      { ...base, incomeInputMode: "AMOUNT" },
    ).incomeInputMode,
    "RATE",
  );
  assert.equal(
    transactionInput(
      { incomeInputMode: "AMOUNT" },
      { ...base, incomeInputMode: "RATE" },
    ).incomeInputMode,
    "AMOUNT",
  );
  assert.throws(
    () =>
      transactionInput(
        { incomeInputMode: "INVALID" },
        { ...base, incomeInputMode: "RATE" },
      ),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "INVALID_REQUEST",
  );
  assert.equal(transactionInput(base).incomeInputMode, "AMOUNT");
});

/* Legacy card-transaction list tests removed: the endpoint is no longer registered. */
/* test("transaction list resolves one transaction with one reference batch", async (t) => {
  const cardId = "507f1f77bcf86cd799439011";
  const statementId = "507f1f77bcf86cd799439021";
  t.mock.method(CardTransactionModel, "find", () => ({
    sort: async () => [{
      _id: "507f1f77bcf86cd799439031",
      workspaceId: "workspace-a",
      userCardId: cardId,
      statementId,
      transactionDate: "2026-07-13",
      outcomeAmount: 300,
      incomeAmount: 0,
      cashbackRateBps: 0,
    }],
  }) as never);
  const cardFind = t.mock.method(CreditCardModel, "find", async () => [{
    _id: cardId,
    workspaceId: "workspace-a",
    providerName: "Bank A",
    displayName: "Card A",
    network: "Visa",
    owner: "A",
  }] as never);
  const statementFind = t.mock.method(CardStatementModel, "find", async () => [{
    _id: statementId,
    workspaceId: "workspace-a",
    userCardId: cardId,
    paymentStatus: "OPEN",
    paymentDueDate: "2026-07-20",
  }] as never);
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret);

  const response = await app.inject({
    url: "/api/card-transactions",
    headers: { cookie },
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].card._id, cardId);
  assert.equal(body.data[0].statement._id, statementId);
  assert.equal(cardFind.mock.callCount(), 1);
  assert.equal(statementFind.mock.callCount(), 1);
  await app.close();
});

test("transaction list batch-loads unique workspace-scoped references without changing order or shape", async (t) => {
  const cardA = "507f1f77bcf86cd799439011";
  const cardB = "507f1f77bcf86cd799439012";
  const missingCard = "507f1f77bcf86cd799439013";
  const statementA = "507f1f77bcf86cd799439021";
  const statementB = "507f1f77bcf86cd799439022";
  const missingStatement = "507f1f77bcf86cd799439023";
  const items = [
    { _id: "507f1f77bcf86cd799439031", workspaceId: "workspace-a", userCardId: cardA, statementId: statementA, transactionDate: "2026-07-13", outcomeAmount: 300, incomeAmount: 0, cashbackRateBps: 0 },
    { _id: "507f1f77bcf86cd799439032", workspaceId: "workspace-a", userCardId: cardA, statementId: statementA, transactionDate: "2026-07-12", outcomeAmount: 200, incomeAmount: 0, cashbackRateBps: 0 },
    { _id: "507f1f77bcf86cd799439033", workspaceId: "workspace-a", userCardId: cardB, statementId: statementB, transactionDate: "2026-07-11", outcomeAmount: 100, incomeAmount: 0, cashbackRateBps: 0 },
    { _id: "507f1f77bcf86cd799439034", workspaceId: "workspace-a", userCardId: missingCard, statementId: missingStatement, transactionDate: "2026-07-10", outcomeAmount: 50, incomeAmount: 0, cashbackRateBps: 0 },
    { _id: "507f1f77bcf86cd799439035", workspaceId: "workspace-a", userCardId: cardB, transactionDate: "2026-07-09", outcomeAmount: 25, incomeAmount: 0, cashbackRateBps: 0 },
  ];
  const transactionFind = t.mock.method(CardTransactionModel, "find", () => ({
    sort: async () => items,
  }) as never);
  const cardFind = t.mock.method(CreditCardModel, "find", async () => [
    { _id: cardA, workspaceId: "workspace-a", providerName: "Bank A", displayName: "Card A", network: "Visa", owner: "A" },
    { _id: cardB, workspaceId: "workspace-a", providerName: "Bank B", displayName: "Card B", network: "Mastercard", owner: "B" },
  ] as never);
  const statementFind = t.mock.method(CardStatementModel, "find", async () => [
    { _id: statementA, workspaceId: "workspace-a", userCardId: cardA, paymentStatus: "OPEN", paymentDueDate: "2026-07-20" },
    { _id: statementB, workspaceId: "workspace-a", userCardId: cardB, paymentStatus: "OPEN", paymentDueDate: "2026-07-21" },
  ] as never);
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret);

  const response = await app.inject({
    url: "/api/card-transactions",
    headers: { cookie },
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.data.map((item: { _id: string }) => item._id), items.map((item) => item._id));
  assert.equal(body.data[0].card.displayName, "Card A");
  assert.equal(body.data[0].statement._id, statementA);
  assert.equal(body.data[2].card.displayName, "Card B");
  assert.equal(body.data[2].statement._id, statementB);
  assert.equal("card" in body.data[3], false);
  assert.equal("statement" in body.data[3], false);
  assert.equal(body.data[4].card.displayName, "Card B");
  assert.equal("statement" in body.data[4], false);
  assert.equal(transactionFind.mock.callCount(), 1);
  assert.equal(cardFind.mock.callCount(), 1);
  assert.equal(statementFind.mock.callCount(), 1);
  assert.deepEqual(cardFind.mock.calls[0]?.arguments[0], {
    _id: { $in: [cardA, cardB, missingCard] },
    workspaceId: "workspace-a",
  });
  assert.deepEqual(statementFind.mock.calls[0]?.arguments[0], {
    _id: { $in: [statementA, statementB, missingStatement] },
    workspaceId: "workspace-a",
  });
  await app.close();
}); */

test("card statement dashboard returns bounded summaries without nested transactions", async (t) => {
  const cardA = "507f1f77bcf86cd799439011";
  const cardB = "507f1f77bcf86cd799439012";
  const statementA = "507f1f77bcf86cd799439021";
  const statementB = "507f1f77bcf86cd799439022";
  const cardFind = t.mock.method(CreditCardModel, "find", () => ({
    sort: async () => [
      { _id: cardA, workspaceId: "workspace-a", cashbackCapAmount: 500 },
      { _id: cardB, workspaceId: "workspace-a", cashbackCapAmount: null },
    ],
  }) as never);
  const statementFind = t.mock.method(CardStatementModel, "find", () => ({
    sort: async () => [
      { _id: statementB, workspaceId: "workspace-a", userCardId: cardB, statementDate: "2099-07-12", paymentDueDate: "2099-07-27", paymentStatus: "OPEN" },
      { _id: statementA, workspaceId: "workspace-a", userCardId: cardA, statementDate: "2099-07-11", paymentDueDate: "2099-07-26", paymentStatus: "OPEN" },
    ],
  }) as never);
  const transactionFind = t.mock.method(FinancialTransactionModel, "find", async () => [
    { _id: "507f1f77bcf86cd799439031", statementId: statementA, accountId: cardA, accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "OTHER", amount: 300, creditDebt: 300, personalSpending: 300, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, serviceFeeRate: 10, transactionDate: "2099-07-10", note: "" },
    { _id: "507f1f77bcf86cd799439032", statementId: statementA, accountId: cardA, accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "OTHER", amount: 200, creditDebt: 200, personalSpending: 200, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, serviceFeeRate: 10, transactionDate: "2099-07-10", note: "" },
    { _id: "507f1f77bcf86cd799439033", statementId: statementB, accountId: cardB, accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "OTHER", amount: 100, creditDebt: 100, personalSpending: 100, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, serviceFeeRate: 0, transactionDate: "2099-07-10", note: "" },
  ] as never);
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret);

  const response = await app.inject({
    url: "/api/card-statements",
    headers: { cookie },
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.data.map((item: { id: string }) => item.id), [
    statementB,
    statementA,
  ]);
  assert.equal(body.data[0].summary.statementAmount, 100);
  assert.equal(body.data[1].summary.statementAmount, 500);
  assert.equal(body.data[0].effectivePaymentStatus, "OPEN");
  assert.equal("transactions" in body.data[0], false);
  assert.equal("transactions" in body.data[1], false);
  assert.equal(cardFind.mock.callCount(), 1);
  assert.equal(statementFind.mock.callCount(), 1);
  assert.equal(transactionFind.mock.callCount(), 1);
  assert.deepEqual(cardFind.mock.calls[0]?.arguments[0], {
    _id: { $in: [cardB, cardA] },
    workspaceId: "workspace-a",
  });
  assert.deepEqual(statementFind.mock.calls[0]?.arguments[0], {
    workspaceId: "workspace-a",
  });
  assert.deepEqual(transactionFind.mock.calls[0]?.arguments[0], {
    statementId: { $in: [statementB, statementA] }, workspaceId: "workspace-a",
  });
  await app.close();
});

test("per-card statement list loads all statement transactions in one query", async (t) => {
  const cardId = "507f1f77bcf86cd799439011";
  const statementA = "507f1f77bcf86cd799439021";
  const statementB = "507f1f77bcf86cd799439022";
  t.mock.method(CreditCardModel, "findOne", async () => ({
    _id: cardId,
    workspaceId: "workspace-a",
    cashbackCapAmount: null,
  }) as never);
  t.mock.method(CardStatementModel, "find", () => ({
    sort: async () => [
      { _id: statementB, workspaceId: "workspace-a", userCardId: cardId, statementDate: "2026-07-12", paymentDueDate: "2026-07-27", paymentStatus: "OPEN" },
      { _id: statementA, workspaceId: "workspace-a", userCardId: cardId, statementDate: "2026-07-11", paymentDueDate: "2026-07-26", paymentStatus: "OPEN" },
    ],
  }) as never);
  const transactionFind = t.mock.method(FinancialTransactionModel, "find", async () => [
    { _id: "507f1f77bcf86cd799439031", statementId: statementA, accountId: cardId, accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "OTHER", amount: 300, creditDebt: 300, personalSpending: 300, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, serviceFeeRate: 0, transactionDate: "2026-07-10", note: "" },
    { _id: "507f1f77bcf86cd799439032", statementId: statementB, accountId: cardId, accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "OTHER", amount: 200, creditDebt: 200, personalSpending: 200, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, serviceFeeRate: 0, transactionDate: "2026-07-10", note: "" },
  ] as never);
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret);

  const response = await app.inject({
    url: `/api/cards/${cardId}/statements`,
    headers: { cookie },
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.data.map((item: { id: string }) => item.id), [
    statementB,
    statementA,
  ]);
  assert.equal(body.data[0].summary.statementAmount, 200);
  assert.equal(body.data[1].summary.statementAmount, 300);
  assert.equal(transactionFind.mock.callCount(), 1);
  assert.deepEqual(transactionFind.mock.calls[0]?.arguments[0], {
    statementId: { $in: [statementB, statementA] },
    workspaceId: "workspace-a",
  });
  await app.close();
});

test("transaction, statement and report routes enforce sessions before database access", async () => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret);
  for (const url of ["/api/card-statements", "/api/cards/507f1f77bcf86cd799439011/statements"]) assert.equal((await app.inject({ url })).statusCode, 401);
  await app.close();
});

test("paginated statement routes expose the canonical page envelope", async (t) => {
  let observed: { includeTransactions?: boolean } | undefined;
  t.mock.method(StatementQueryService, "listPage", async (_context: unknown, options: { includeTransactions?: boolean }) => { observed = options; return { data: [{ id: "statement-1" }], nextCursor: "opaque-cursor", limit: 1 } as never; });
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret);
  const response = await app.inject({ url: "/api/card-statements?limit=1", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, { items: [{ id: "statement-1" }], nextCursor: "opaque-cursor", limit: 1 });
  assert.equal(observed?.includeTransactions, false);
  await app.close();
});
