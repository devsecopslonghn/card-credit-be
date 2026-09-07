import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import type { ServiceContext } from "../src/services/types/service-context.js";
import { AccountModel } from "../src/models/account.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { CashFlowQueryService } from "../src/services/cash-flow-query-service.js";
import { registerCashFlowRoutes } from "../src/cash-flow-routes.js";
import { CardFeePaymentModel } from "../src/models/card-fee-payment.js";
import { MonthlyCardCashbackModel } from "../src/models/monthly-card-cashback.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "cash-flow-test" };
const card1 = "507f1f77bcf86cd799439011";
const card2 = "507f1f77bcf86cd799439012";
const account1 = "507f1f77bcf86cd799439021";
const statement1 = "507f1f77bcf86cd799439031";
const query = <T>(value: T) => {
  const chain = { sort: () => chain, select: () => chain, lean: async () => value };
  return chain;
};

test("cash-flow query service preserves the Financial Domain joins and formulas", async (t) => {
  t.mock.method(CreditCardModel, "find", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a" });
    return query([{ _id: card1, providerName: "Bank", displayName: "Visa", owner: "Tôi" }, { _id: card2, providerName: "Other", displayName: "Master", owner: "Bạn" }]) as never;
  });
  t.mock.method(AccountModel, "find", (filter: Record<string, unknown>) => {
    assert.equal(filter.workspaceId, "workspace-a");
    return query([{ _id: account1, creditCardId: card1 }]) as never;
  });
  t.mock.method(CardStatementModel, "find", (filter: Record<string, unknown>) => {
    assert.equal(filter.workspaceId, "workspace-a");
    return query([{ _id: statement1, userCardId: card1 }]) as never;
  });
  t.mock.method(FinancialTransactionModel, "find", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a", transactionDate: { $gte: "2026-08-01", $lt: "2026-09-01" } });
    return query([
      { accountType: "CREDIT", accountId: account1, transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", amount: 100, reimbursementExpected: 20, cashbackReceived: 3 },
      { accountType: "CREDIT", accountId: account1, transactionType: "STATEMENT_PAYMENT", statementId: statement1, amount: 150 },
      { accountType: "CREDIT", accountId: account1, transactionType: "REFUND", amount: 25 },
      { accountType: "DEBIT", accountId: "other", transactionType: "REFUND", amount: 999 },
    ]) as never;
  });
  t.mock.method(CardFeePaymentModel, "find", (filter: Record<string, unknown>) => {
    assert.equal(filter.workspaceId, "workspace-a");
    return query([{ userCardId: card1, category: "ANNUAL_CARD_FEE", amount: 80 }]) as never;
  });
  t.mock.method(MonthlyCardCashbackModel, "find", (filter: Record<string, unknown>) => {
    assert.equal(filter.workspaceId, "workspace-a");
    assert.equal(filter.period, "2026-08");
    return query([{ userCardId: card1, status: "RECEIVED", actualAmount: 3 }]) as never;
  });

  const result = await CashFlowQueryService.list(context, { period: "2026-08" });
  assert.deepEqual(result.data[0], {
    cardId: card1, period: "2026-08", totalOut: 230, totalIn: 28,
    statementPayments: 150, actualFees: 80, partnerReturns: 25,
    bankCashbackActual: 3, netResult: -202,
    card: { id: card1, providerName: "Bank", displayName: "Visa", owner: "Tôi" },
  });
  assert.equal(result.data[1]?.totalOut, 0);
  assert.equal(result.data[1]?.totalIn, 0);
});

test("cash-flow query rejects malformed period before model reads", async (t) => {
  const find = t.mock.method(CreditCardModel, "find");
  await assert.rejects(() => CashFlowQueryService.list(context, { period: "2026-13" }), (error: unknown) => (error as { code?: string }).code === "INVALID_PERIOD");
  assert.equal(find.mock.callCount(), 0);
});

test("cash-flow REST adapter keeps envelope and compatibility card aliases", async (t) => {
  t.mock.method(CashFlowQueryService, "list", async (ctx: ServiceContext, options: { period?: string; cardId?: string }) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    assert.equal(options.period, "2026-08");
    return { period: "2026-08", data: [{ cardId: card1, period: "2026-08", totalOut: 0, totalIn: 0, statementPayments: 0, actualFees: 0, partnerReturns: 0, bankCashbackActual: 0, netResult: 0, card: { id: card1, providerName: "Bank", displayName: "Visa", owner: "Tôi" } }] };
  });
  const app = buildApp({ isReady: () => true }, "silent");
  const users = { findUserById: async (id: string) => id === "user-a" ? { id, email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null } : null };
  registerCashFlowRoutes(app, "01234567890123456789012345678901", users);
  const response = await app.inject({ url: "/api/cash-flow/monthly?period=2026-08", headers: { cookie: sessionCookie(signSession({ userId: "user-a", email: "user@example.test", role: "user", workspaceId: "workspace-a" }, "01234567890123456789012345678901")) } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data[0].card.bank, "Bank");
  assert.equal(response.json().data[0].card.name, "Visa");
  await app.close();
});
