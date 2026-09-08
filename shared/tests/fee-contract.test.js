import assert from "node:assert/strict";
import test from "node:test";
import { feeCenterRecordListSchema, feePaymentListSchema } from "../src/index.js";

const payment = { id: "fee-1", cardId: "card-1", category: "ANNUAL_CARD_FEE", paymentDate: "2026-07-23", amount: 299000, note: "Phí năm" };

test("fee read contracts normalize card fee and Fee Center records", () => {
  assert.deepEqual(feePaymentListSchema.parse([payment]), [payment]);
  assert.deepEqual(feeCenterRecordListSchema.parse([{ ...payment, card: { id: "card-1", providerName: "Bank", displayName: "Visa", owner: "Tôi" } }])[0]?.card?.id, "card-1");
  assert.throws(() => feePaymentListSchema.parse([{ ...payment, paymentDate: "2026-02-30" }]));
  assert.throws(() => feePaymentListSchema.parse([{ ...payment, category: "INVALID" }]));
});
