import assert from "node:assert/strict";
import test from "node:test";
import { monthlyCashFlowResponseSchema } from "../src/index.js";

const row = {
  cardId: "card-1",
  period: "2026-08",
  totalOut: 100,
  totalIn: 25,
  statementPayments: 100,
  actualFees: 10,
  partnerReturns: 25,
  bankCashbackActual: 5,
  netResult: -75,
  card: { id: "card-1", providerName: "Bank", displayName: "Visa", owner: "Tôi" },
};

test("monthly cash-flow contract preserves canonical totals and rejects invalid periods", () => {
  assert.deepEqual(monthlyCashFlowResponseSchema.parse({ data: [row], period: "2026-08" }).data[0], row);
  assert.throws(() => monthlyCashFlowResponseSchema.parse({ data: [{ ...row, period: "2026-13" }], period: "2026-08" }));
  assert.throws(() => monthlyCashFlowResponseSchema.parse({ data: [{ ...row, period: "0000-01" }], period: "2026-08" }));
  assert.throws(() => monthlyCashFlowResponseSchema.parse({ data: [{ ...row, totalOut: -1 }], period: "2026-08" }));
});
