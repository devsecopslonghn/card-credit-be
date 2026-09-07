import assert from "node:assert/strict";
import test from "node:test";
import { feePaymentSchema, financialReportSchema, isoDateSchema, statementSchema, createFinancialTransactionInputSchema } from "../src/index.js";

test("all business date contracts reject impossible calendar dates consistently", () => {
  assert.equal(isoDateSchema.parse("2026-02-28"), "2026-02-28");
  assert.throws(() => isoDateSchema.parse("2026-02-30"));

  const transaction = { accountId: "account-1", transactionDate: "2026-02-30", amount: 1000 };
  assert.throws(() => createFinancialTransactionInputSchema.parse(transaction));

  const fee = { id: "fee-1", cardId: "card-1", category: "OTHER_FEE", paymentDate: "2026-02-30", amount: 1000, note: "" };
  assert.throws(() => feePaymentSchema.parse(fee));

  const statement = { id: "statement-1", cardId: "card-1", periodStartDate: "2026-02-30", periodEndDate: "2026-03-01", statementDate: "2026-03-01", paymentDueDate: "2026-03-15", statementDaySnapshot: 1, paymentDueDaysSnapshot: 14, paymentStatus: "OPEN", effectivePaymentStatus: "OPEN", paidAt: null, paidAmount: null, summary: { statementAmount: 0, paymentAmount: 0, outstandingAmount: 0, personalSpending: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 } };
  assert.throws(() => statementSchema.parse(statement));

  const report = { range: { from: "2026-02-30", to: "2026-03-01" }, totals: { personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0, totalServiceFee: 0, transactionCashbackActual: 0, monthlyBankCashbackExpected: 0, monthlyBankCashbackActual: 0, monthlyBankCashbackRejected: 0, totalPaidCardFees: 0, actualNetBenefit: 0 }, netAssets: 0, creditDebtBalance: 0, debit: { personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 }, cash: { personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 }, eWallet: { personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 }, realMoney: { personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 }, credit: { personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 }, byCategory: {}, byAccount: {} };
  assert.throws(() => financialReportSchema.parse(report));
});
