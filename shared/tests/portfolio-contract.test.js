import assert from "node:assert/strict";
import test from "node:test";
import { cardPortfolioCardSchema, cardPortfolioListSchema } from "../src/index.js";

const card = {
  id: "507f1f77bcf86cd799439011",
  presetId: "test-visa",
  providerCode: "TST",
  providerName: "Test Bank",
  displayName: "Test Visa",
  network: "Visa",
  owner: "Tôi",
  imageUrl: null,
  annualFee: null,
  targetSpendForWaiver: null,
  annualFeeWaiverTarget: null,
  statementDay: null,
  paymentDueDays: null,
  cashbackCapAmount: null,
  cashbackCapPeriod: null,
  active: true,
  reminderEnabled: true,
  reminderDaysBefore: [],
  reminderTimezone: null,
  reminderTime: null,
};

test("card portfolio contract preserves canonical identity and inactive state", () => {
  assert.deepEqual(cardPortfolioCardSchema.parse(card), card);
  assert.equal(cardPortfolioListSchema.parse([{ ...card, active: false }])[0].active, false);
  assert.throws(() => cardPortfolioCardSchema.parse({ ...card, id: "" }));
});
