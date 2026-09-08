import test from "node:test";
import assert from "node:assert/strict";
import { inspectFinanceRepair, reconcileFinanceMonth } from "../src/finance-repair.js";

test("dry-run repair detects stale type, duplicate, technical income, archived balance and paid conflict", () => {
  const report = inspectFinanceRepair([
    { _id: "cash", type: "CASH", active: true, openingBalance: 100 },
    { _id: "archived", type: "DEBIT", active: false, openingBalance: 200 },
  ], [
    { _id: "tx-1", workspaceId: "w", accountId: "cash", accountType: "DEBIT", transactionType: "INCOME", amount: 50, debitCashflow: 50, transactionDate: "2026-08-01", note: "opening balance adjustment" },
    { _id: "tx-2", workspaceId: "w", accountId: "cash", accountType: "CASH", transactionType: "EXPENSE", amount: 10, debitCashflow: -10, transactionDate: "2026-08-02" },
    { _id: "tx-3", workspaceId: "w", accountId: "cash", accountType: "CASH", transactionType: "EXPENSE", amount: 10, debitCashflow: -10, transactionDate: "2026-08-02" },
    { _id: "tx-4", workspaceId: "w", accountId: "archived", accountType: "DEBIT", transactionType: "EXPENSE", amount: 20, debitCashflow: -20, transactionDate: "2026-08-03" },
    { _id: "tx-5", workspaceId: "w", accountId: "cash", accountType: "CASH", transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", amount: 100, creditDebt: 100, statementId: "statement-1", transactionDate: "2026-08-04" },
    { _id: "tx-6", workspaceId: "w", accountId: "cash", accountType: "CASH", transactionType: "REIMBURSEMENT", amount: 100, reimbursementForTransactionId: "tx-5", transactionDate: "2026-08-05" },
  ], [{ _id: "statement-1", paymentStatus: "PAID", paidAmount: 0, summary: { outstandingAmount: 100 } }]);
  assert.equal(report.staleAccountType.length, 1);
  assert.equal(report.duplicates.length, 1);
  assert.deepEqual(report.technicalIncome, ["tx-1"]);
  assert.equal(report.archivedBalances[0]?.accountId, "archived");
  assert.equal(report.paidStatementConflicts[0]?.statementId, "statement-1");
  assert.equal(report.reimbursementOnPaidStatement[0]?.statementId, "statement-1");
  assert.deepEqual(report.technicalAdjustmentFees, []);
  assert.deepEqual(report.adjustmentLikeWrongType, [{ transactionId: "tx-1", transactionType: "INCOME" }]);
  assert.equal(report.writeRequired, true);
});

test("monthly reconciliation excludes archived accounts and technical adjustments from operating cashflow", () => {
  const result = reconcileFinanceMonth([
    { _id: "cash", type: "CASH", active: true, openingBalance: 100 },
    { _id: "archived", type: "DEBIT", active: false, openingBalance: 900 },
  ], [
    { _id: "income", accountId: "cash", transactionDate: "2026-08-10", transactionType: "INCOME", amount: 50, debitCashflow: 50, personalSpending: 0 },
    { _id: "opening", accountId: "cash", transactionDate: "2026-08-11", transactionType: "OPENING_BALANCE_ADJUSTMENT", amount: 900, debitCashflow: 900, personalSpending: 0 },
  ], [{ _id: "statement", paymentStatus: "OPEN", summary: { outstandingAmount: 40, paymentAmount: 0 } }], { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(result.activeRealMoney, 1050);
  assert.equal(result.realIncome, 50);
  assert.equal(result.operatingCashflow, 50);
  assert.equal(result.technicalAdjustments, 900);
  assert.equal(result.netAssets, 1010);
});
