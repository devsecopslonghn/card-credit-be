import assert from "node:assert/strict";
import test from "node:test";
import { cardDuplicateGroupSchema } from "../src/index.js";

const card = (id) => ({
  id,
  presetId: "preset-a",
  providerCode: "BANK",
  providerName: "Bank",
  displayName: "Card",
  network: "Visa",
  legacy: false,
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
  statementDate: null,
  paymentDueDate: null,
  amountDueThisMonth: null,
  isPaidThisMonth: null,
  monthlyData: [],
});

test("duplicate group contract contains canonical cards and rejects incomplete groups", () => {
  assert.equal(cardDuplicateGroupSchema.parse({
    fingerprint: "workspace::preset-a::Tôi",
    presetId: "preset-a",
    normalizedOwner: "Tôi",
    reason: "Exact duplicate",
    cards: [card("card-1"), card("card-2")],
  }).cards.length, 2);
  assert.throws(() => cardDuplicateGroupSchema.parse({
    fingerprint: "workspace::preset-a::Tôi",
    presetId: "preset-a",
    normalizedOwner: "Tôi",
    reason: "Exact duplicate",
    cards: [card("card-1")],
  }));
});
