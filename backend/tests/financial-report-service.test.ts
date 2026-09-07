import assert from "node:assert/strict";
import test from "node:test";
import { FinancialReportService, readReportCollection } from "../src/services/financial-report-service.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { AccountModel } from "../src/models/account.js";
import { MonthlyCardCashbackModel } from "../src/models/monthly-card-cashback.js";
import { CardFeePaymentModel } from "../src/models/card-fee-payment.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { FinanceCategoryModel } from "../src/models/finance-category.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "report-test" };
const statement = {
  id: "507f1f77bcf86cd799439021", cardId: "507f1f77bcf86cd799439011", periodStartDate: "2026-07-01", periodEndDate: "2026-07-31",
  statementDate: "2026-07-31", paymentDueDate: "2026-08-15", statementDaySnapshot: 31, paymentDueDaysSnapshot: 15,
  paymentStatus: "OPEN", effectivePaymentStatus: "OPEN", paidAt: null, paidAmount: null,
  summary: { statementAmount: 600_000, paymentAmount: 100_000, outstandingAmount: 500_000, personalSpending: 600_000, outstandingReceivable: 25_000, reimbursementReceived: 75_000, transactionCount: 2 },
  transactions: [],
};

const chain = <T>(value: T) => {
  const query = { select: () => query, lean: async () => value };
  return query;
};

test("report collection reader consumes complete Mongo cursors and keeps a lean fallback", async () => {
  const cursor = async function* () {
    yield { id: "first" };
    yield { id: "second" };
  };
  assert.deepEqual(await readReportCollection<{ id: string }>({ lean: () => ({ cursor: (options: { batchSize?: number }) => { assert.deepEqual(options, { batchSize: 100 }); return cursor(); } }) }), [{ id: "first" }, { id: "second" }]);
  assert.deepEqual(await readReportCollection<{ id: string }>({ lean: async () => [{ id: "fallback" }] }), [{ id: "fallback" }]);
});

test("summary reads benefit sources once, keeps ledger groups stable and avoids cashback double count", async (t) => {
  const transactions = [
    { _id: "tx-personal", accountId: "account-credit", accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "food", amount: 1_000, reimbursementExpected: 0, cashbackReceived: 10, personalSpending: 1_000, debitCashflow: 0, creditDebt: 1_000, outstandingReceivable: 0, reimbursementReceived: 0 },
    { _id: "tx-fee", accountId: "account-credit", accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", categoryId: "other", amount: 500, reimbursementExpected: 400, refundReceived: 25, cashbackReceived: 0, personalSpending: 75, debitCashflow: 0, creditDebt: 500, outstandingReceivable: 400, reimbursementReceived: 0 },
    { _id: "tx-payment", accountId: "account-debit", accountType: "DEBIT", transactionType: "STATEMENT_PAYMENT", ownership: "PERSONAL", categoryId: "OTHER", amount: 200, reimbursementExpected: 0, cashbackReceived: 0, personalSpending: 0, debitCashflow: -200, creditDebt: -200, outstandingReceivable: 0, reimbursementReceived: 0 },
  ];
  const transactionFind = t.mock.method(FinancialTransactionModel, "find", (query: Record<string, unknown>) => chain(query.transactionType === "REIMBURSEMENT" ? [{ amount: 100 }] : transactions) as never);
  t.mock.method(AccountModel, "find", () => chain([
    { _id: "account-credit", name: "Credit", type: "CREDIT", openingBalance: 0 },
    { _id: "account-debit", name: "Debit", type: "DEBIT", openingBalance: 0 },
  ]) as never);
  const cashbackFind = t.mock.method(MonthlyCardCashbackModel, "find", () => chain([
    { expectedAmount: 100, actualAmount: null, status: "PENDING" },
    { expectedAmount: 200, actualAmount: 150, status: "RECEIVED" },
    { expectedAmount: 300, actualAmount: 400, status: "REJECTED" },
  ]) as never);
  const feeFind = t.mock.method(CardFeePaymentModel, "find", () => chain([
    { category: "ANNUAL_CARD_FEE", amount: 40 },
    { category: "MANAGEMENT_FEE", amount: 60 },
    { category: "BANK_CASHBACK", amount: 900 },
  ]) as never);
  const categoryFind = t.mock.method(FinanceCategoryModel, "find", () => chain([{ _id: "legacy-category", name: "LEGACY" }]) as never);
  t.mock.method(CreditCardModel, "find", () => chain([]) as never);
  t.mock.method(StatementQueryService, "list", async (_ctx: ServiceContext, options: Record<string, unknown>) => options.includeTransactions === false ? [{ ...statement }] as never : [] as never);

  const result = await FinancialReportService.summary(context, { from: "2026-07-01", to: "2026-07-31" });

  assert.equal(result.totals.totalServiceFee, 75);
  assert.equal(result.totals.transactionCashbackActual, 10);
  assert.equal(result.totals.monthlyBankCashbackExpected, 600);
  assert.equal(result.totals.monthlyBankCashbackActual, 150);
  assert.equal(result.totals.monthlyBankCashbackRejected, 300);
  assert.equal(result.totals.totalPaidCardFees, 100);
  assert.equal(result.totals.actualNetBenefit, -25);
  assert.equal(result.totals.creditDebt, 1_300);
  assert.equal(result.creditDebtBalance, 500_000);
  assert.equal(result.byAccount["account-credit"]?.transactionCount, 2);
  assert.equal(transactionFind.mock.callCount(), 3);
  assert.deepEqual(transactionFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", transactionDate: { $gte: "2026-07-01", $lte: "2026-07-31" } });
  assert.deepEqual(cashbackFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", period: { $gte: "2026-07", $lte: "2026-07" } });
  assert.deepEqual(feeFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", paymentDate: { $gte: "2026-07-01", $lte: "2026-07-31" }, category: { $in: ["ANNUAL_CARD_FEE", "MANAGEMENT_FEE", "OTHER_FEE"] } });
  assert.equal(categoryFind.mock.callCount(), 0);
  assert.equal(JSON.stringify(result).includes("monthlyData"), false);
});

test("summary owner filter scopes ledger, cashback and fee sources by card references", async (t) => {
  const cardIds = ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"];
  const cardFind = t.mock.method(CreditCardModel, "find", () => chain(cardIds.map((_id) => ({ _id }))) as never);
  const accountFind = t.mock.method(AccountModel, "find", (query: Record<string, unknown>) => chain(query.creditCardId ? [{ _id: "account-card" }] : []) as never);
  const statementFind = t.mock.method(CardStatementModel, "find", () => chain([{ _id: "statement-card" }]) as never);
  const transactionFind = t.mock.method(FinancialTransactionModel, "find", () => chain([]) as never);
  const cashbackFind = t.mock.method(MonthlyCardCashbackModel, "find", () => chain([]) as never);
  const feeFind = t.mock.method(CardFeePaymentModel, "find", () => chain([]) as never);
  t.mock.method(StatementQueryService, "list", async () => [] as never);

  await FinancialReportService.summary(context, { from: "2026-08-01", to: "2026-08-31" }, { owner: "Tôi" });

  assert.deepEqual(cardFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", owner: "Tôi" });
  assert.deepEqual(accountFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", active: { $ne: false }, creditCardId: { $in: cardIds } });
  assert.deepEqual(statementFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", userCardId: { $in: cardIds } });
  assert.deepEqual(transactionFind.mock.calls[0]?.arguments[0], {
    workspaceId: "workspace-a",
    transactionDate: { $gte: "2026-08-01", $lte: "2026-08-31" },
    $or: [{ accountId: { $in: ["account-card"] } }, { statementId: { $in: ["statement-card"] } }],
  });
  assert.deepEqual(cashbackFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", userCardId: { $in: cardIds }, period: { $gte: "2026-08", $lte: "2026-08" } });
  assert.deepEqual(feeFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", userCardId: { $in: cardIds }, paymentDate: { $gte: "2026-08-01", $lte: "2026-08-31" }, category: { $in: ["ANNUAL_CARD_FEE", "MANAGEMENT_FEE", "OTHER_FEE"] } });
  assert.equal(transactionFind.mock.callCount(), 2);
});

test("summary keeps settled receivables audit-only and excludes technical cashflow", async (t) => {
  const transactions = [
    { _id: "settled-a", accountId: "credit", accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", amount: 15_626_797, reimbursementExpected: 15_626_797, receivableStatus: "SETTLED", receivableSettledAmount: 15_626_797, personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 99_999_999, reimbursementReceived: 0 },
    { _id: "settled-b", accountId: "credit", accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", amount: 174_600, reimbursementExpected: 174_600, receivableStatus: "COLLECTED", receivableSettledAmount: 174_600, personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 174_600, reimbursementReceived: 0 },
    { _id: "technical-cash", accountId: "cash", accountType: "CASH", transactionType: "BALANCE_ADJUSTMENT", amount: 100, personalSpending: 0, debitCashflow: 100, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0 },
  ];
  t.mock.method(FinancialTransactionModel, "find", (query: Record<string, unknown>) => chain(query.transactionType === "REIMBURSEMENT" ? [] : transactions) as never);
  t.mock.method(AccountModel, "find", () => chain([
    { _id: "cash", name: "Cash", type: "CASH", openingBalance: 30_999_900 },
    { _id: "credit", name: "Credit", type: "CREDIT", openingBalance: 0 },
  ]) as never);
  t.mock.method(MonthlyCardCashbackModel, "find", () => chain([]) as never);
  t.mock.method(CardFeePaymentModel, "find", () => chain([]) as never);
  t.mock.method(CreditCardModel, "find", () => chain([]) as never);
  t.mock.method(StatementQueryService, "list", async (_ctx: ServiceContext, options: Record<string, unknown>) => options.includeTransactions === false ? [{ ...statement, summary: { ...statement.summary, outstandingAmount: 58_449_472 } }] as never : [] as never);

  const result = await FinancialReportService.summary(context, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(result.totals.activeCashBalance, 31_000_000);
  assert.equal(result.totals.currentCardDebt, 58_449_472);
  assert.equal((result.totals as typeof result.totals & { grossReceivable: number; collectedReceivable: number }).grossReceivable, 15_801_397);
  assert.equal((result.totals as typeof result.totals & { grossReceivable: number; collectedReceivable: number }).collectedReceivable, 15_801_397);
  assert.equal(result.totals.outstandingReceivable, 0);
  assert.equal(result.netAssets, -27_449_472);
  assert.equal(result.totals.debitCashflow, 0);
  assert.equal(result.totals.operatingCashflow, 0);
});

test("credit debt ledger keeps paid statements and exposes gross, paid and outstanding amounts", async (t) => {
  t.mock.method(CreditCardModel, "find", () => chain([{ _id: statement.cardId, providerName: "VIB", displayName: "Max Card", owner: "Tôi" }]) as never);
  t.mock.method(StatementQueryService, "list", async (_ctx: ServiceContext, options: Record<string, unknown>) => {
    assert.deepEqual(options, { statementDateFrom: "2026-07-01", statementDateTo: "2026-07-31", includeTransactions: false });
    return [{ ...statement, paymentStatus: "PAID", effectivePaymentStatus: "PAID" }] as never;
  });

  assert.deepEqual(await FinancialReportService.creditDebtLedger(context, { from: "2026-07-01", to: "2026-07-31" }), [{
    cardId: statement.cardId,
    statementId: statement.id,
    providerName: "VIB",
    displayName: "Max Card",
    owner: "Tôi",
    statementDate: "2026-07-31",
    paymentDueDate: "2026-08-15",
    paymentStatus: "PAID",
    grossDebt: 600_000,
    paidDebt: 100_000,
    outstandingDebt: 500_000,
    transactionCount: 2,
  }]);
});

test("summary rejects malformed and reversed date ranges before reading models", async () => {
  await assert.rejects(() => FinancialReportService.summary(context, { from: "2026-02-30", to: "2026-03-01" }));
  await assert.rejects(() => FinancialReportService.summary(context, { from: "2026-09-01", to: "2026-08-31" }));
});
