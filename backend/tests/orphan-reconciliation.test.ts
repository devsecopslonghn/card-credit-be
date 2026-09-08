import assert from "node:assert/strict";
import test from "node:test";
import { auditOrphanReferences } from "../src/finance-reconciliation.js";

test("orphan reconciliation reports broken references without mutating input", () => {
  const input = {
    cards: [{ _id: "card-1" }],
    statements: [{ _id: "statement-1", userCardId: "card-1" }, { _id: "statement-2", userCardId: "card-missing" }],
    accounts: [{ _id: "account-1", creditCardId: "card-1" }, { _id: "account-2", creditCardId: "card-missing" }],
    transactions: [
      { _id: "transaction-1", accountId: "account-missing", statementId: "statement-1" },
      { _id: "transaction-2", accountId: "account-1", statementId: "statement-missing" },
      { _id: "transaction-3", accountId: null, statementId: null },
    ],
    fees: [{ _id: "fee-1", userCardId: "card-missing" }],
    cashbacks: [{ _id: "cashback-1", userCardId: "card-missing" }],
  };
  const snapshot = structuredClone(input);
  const result = auditOrphanReferences(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result.counts, {
    STATEMENT_CARD: 1,
    ACCOUNT_CARD: 1,
    TRANSACTION_ACCOUNT: 1,
    TRANSACTION_STATEMENT: 1,
    FEE_CARD: 1,
    CASHBACK_CARD: 1,
  });
  assert.deepEqual(result.records, [
    { kind: "ACCOUNT_CARD", recordId: "account-2", referenceId: "card-missing" },
    { kind: "CASHBACK_CARD", recordId: "cashback-1", referenceId: "card-missing" },
    { kind: "FEE_CARD", recordId: "fee-1", referenceId: "card-missing" },
    { kind: "STATEMENT_CARD", recordId: "statement-2", referenceId: "card-missing" },
    { kind: "TRANSACTION_ACCOUNT", recordId: "transaction-1", referenceId: "account-missing" },
    { kind: "TRANSACTION_STATEMENT", recordId: "transaction-2", referenceId: "statement-missing" },
  ]);
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
});

test("orphan reconciliation is stable for the same source references", () => {
  const first = auditOrphanReferences({ cards: [], statements: [{ _id: "s-1", userCardId: "c-1" }], accounts: [], transactions: [], fees: [], cashbacks: [] });
  const second = auditOrphanReferences({ cards: [], statements: [{ _id: "s-1", userCardId: "c-1" }], accounts: [], transactions: [], fees: [], cashbacks: [] });
  assert.deepEqual(second, first);
});
