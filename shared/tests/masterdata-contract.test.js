import assert from "node:assert/strict";
import test from "node:test";
import { masterBankListSchema, masterCardTypeListSchema } from "../src/index.js";

test("masterdata read schemas expose only safe normalized fields", () => {
  const bank = { _id: "bank-1", shortname: "TST", name: "Test", fullname: "Test Bank", logo: "" };
  const cardType = { _id: "type-1", name: "Visa", logo: "" };
  assert.deepEqual(masterBankListSchema.parse([bank]), [bank]);
  assert.deepEqual(masterCardTypeListSchema.parse([cardType]), [cardType]);
  assert.throws(() => masterBankListSchema.parse([{ ...bank, tokenHash: "secret" }]));
  assert.throws(() => masterCardTypeListSchema.parse([{ ...cardType, createdAt: "secret" }]));
  assert.throws(() => masterBankListSchema.parse([{ ...bank, _id: "" }]));
});
