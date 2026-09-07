import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialImpact } from "../src/financial-domain.js";

test("debit expense reduces real-money balance and personal spending", () => {
  assert.deepEqual(
    calculateFinancialImpact({ accountType: "DEBIT", amount: 40000 }),
    {
      grossAmount: 40000,
      personalSpending: 40000,
      debitCashflow: -40000,
      creditDebt: 0,
      outstandingReceivable: 0,
      reimbursementReceived: 0,
    },
  );
});

test("credit expense creates debt without debit cashflow", () => {
  assert.deepEqual(
    calculateFinancialImpact({ accountType: "CREDIT", amount: 1000000 }),
    {
      grossAmount: 1000000,
      personalSpending: 1000000,
      debitCashflow: 0,
      creditDebt: 1000000,
      outstandingReceivable: 0,
      reimbursementReceived: 0,
    },
  );
});

test("statement payment settles credit debt but is not personal spending", () => {
  assert.deepEqual(
    calculateFinancialImpact({
      accountType: "DEBIT",
      transactionType: "STATEMENT_PAYMENT",
      amount: 15000000,
    }),
    {
      grossAmount: 15000000,
      personalSpending: 0,
      debitCashflow: -15000000,
      creditDebt: -15000000,
      outstandingReceivable: 0,
      reimbursementReceived: 0,
    },
  );
});

test("paid-for-other tracks receivable and only personal remainder", () => {
  assert.deepEqual(
    calculateFinancialImpact({
      accountType: "CREDIT",
      amount: 15000000,
      ownership: "PAID_FOR_OTHER",
      serviceFeeRate: 6.6666667,
    }),
    {
      grossAmount: 15000000,
      personalSpending: 1000000,
      debitCashflow: 0,
      creditDebt: 15000000,
      outstandingReceivable: 14000000,
      reimbursementReceived: 0,
    },
  );
});

test("reimbursement is debit inflow, not personal spending", () => {
  assert.deepEqual(
    calculateFinancialImpact({ accountType: "DEBIT", transactionType: "REIMBURSEMENT", amount: 14000000 }),
    {
      grossAmount: 14000000,
      personalSpending: 0,
      debitCashflow: 14000000,
      creditDebt: 0,
      outstandingReceivable: 0,
      reimbursementReceived: 14000000,
    },
  );
});

test("signed balance adjustments change snapshot balance without operating impact", () => {
  assert.deepEqual(calculateFinancialImpact({ accountType: "CASH", transactionType: "BALANCE_ADJUSTMENT", direction: "DECREASE", amount: 16_314_918 }), {
    grossAmount: 16_314_918,
    personalSpending: 0,
    debitCashflow: -16_314_918,
    creditDebt: 0,
    outstandingReceivable: 0,
    reimbursementReceived: 0,
  });
});

test("paid-for-other fee rate is supplied by the caller", () => {
  assert.deepEqual(
    calculateFinancialImpact({ accountType: "CREDIT", amount: 1000000, ownership: "PAID_FOR_OTHER", serviceFeeRate: 5 }),
    { grossAmount: 1000000, personalSpending: 50000, debitCashflow: 0, creditDebt: 1000000, outstandingReceivable: 950000, reimbursementReceived: 0 },
  );
});
