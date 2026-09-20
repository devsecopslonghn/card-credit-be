import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalFinancePlan } from "../src/canonical-finance.js";

test("canonical finance plan uses account type and clears settled receivables", () => {
  const plan = buildCanonicalFinancePlan(
    [{ _id: "cash-1", type: "CASH" }, { _id: "credit-1", type: "CREDIT" }],
    [
      { _id: "tx-1", accountId: "cash-1", accountType: "DEBIT", transactionType: "EXPENSE", ownership: "PERSONAL", outstandingReceivable: 0 },
      { _id: "source-1", accountId: "credit-1", accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", reimbursementExpected: 1_000, outstandingReceivable: 1_000, receivableStatus: "SETTLED", receivableSettledAmount: 1_000 },
      { _id: "refund-1", accountId: "cash-1", accountType: "DEBIT", transactionType: "REIMBURSEMENT", reimbursementForTransactionId: "source-1", amount: 1_000 },
      { _id: "voided-refund", accountId: "cash-1", accountType: "DEBIT", transactionType: "REIMBURSEMENT", reimbursementForTransactionId: "source-1", amount: 999, voidedAt: new Date("2026-09-01") },
    ],
  );

  assert.deepEqual(plan.accountTypeUpdates, [
    { transactionId: "tx-1", accountType: "CASH", previousAccountType: "DEBIT" },
    { transactionId: "refund-1", accountType: "CASH", previousAccountType: "DEBIT" },
    { transactionId: "voided-refund", accountType: "CASH", previousAccountType: "DEBIT" },
  ]);
  assert.deepEqual(plan.receivableUpdates, [{ transactionId: "source-1", outstandingReceivable: 0, previousOutstandingReceivable: 1_000 }]);
  assert.deepEqual(plan.unresolvedAccountReferences, []);
});

test("canonical finance plan does not silently repair an unresolved account reference", () => {
  const plan = buildCanonicalFinancePlan(
    [{ _id: "cash-1", type: "CASH" }],
    [{ _id: "tx-1", accountId: "missing-account", accountType: "DEBIT", transactionType: "EXPENSE", ownership: "PERSONAL" }],
  );

  assert.deepEqual(plan.accountTypeUpdates, []);
  assert.deepEqual(plan.receivableUpdates, []);
  assert.deepEqual(plan.unresolvedAccountReferences, ["missing-account"]);
});
