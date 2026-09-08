import test from "node:test";
import assert from "node:assert/strict";
import { paymentTotals } from "../src/services/statement-payment-command-service.js";
import { calculateFinancialImpact } from "../src/financial-domain.js";
import { nextPaymentState } from "../src/services/statement-payment-command-service.js";

test("reimbursement does not reduce Max or UOB card debt", () => {
  const max = paymentTotals([{ transactionType: "EXPENSE", amount: 16_193_000, creditDebt: 16_193_000 }, { transactionType: "REIMBURSEMENT", amount: 15_543_000, creditDebt: 0 }]);
  const uob = paymentTotals([{ transactionType: "EXPENSE", amount: 19_994_000, creditDebt: 19_994_000 }, { transactionType: "REIMBURSEMENT", amount: 19_434_168, creditDebt: 0 }]);
  assert.equal(max.outstandingAmount, 16_193_000);
  assert.equal(uob.outstandingAmount, 19_994_000);
});

test("technical balance adjustment has no operating impact and PAID correction requires explicit reason", () => {
  const impact = calculateFinancialImpact({ accountType: "CASH", transactionType: "OPENING_BALANCE_ADJUSTMENT", amount: 20_000_000 });
  assert.deepEqual(impact, { grossAmount: 20_000_000, personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0 });
  assert.equal(nextPaymentState("PAID", "REOPEN", "Correction: reimbursement was incorrectly treated as payment"), "OPEN");
  assert.throws(() => nextPaymentState("PAID", "REOPEN"));
});

test("net assets uses active money plus receivable minus current debt", () => {
  assert.equal(31_121_918 + 15_801_397 - 58_082_100, -11_158_785);
});
