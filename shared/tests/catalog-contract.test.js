import assert from "node:assert/strict";
import test from "node:test";
import { catalogProductSchema, catalogProviderListSchema } from "../src/index.js";

const product = {
  presetId: "test-visa",
  providerCode: "TST",
  providerName: "Test Bank",
  displayName: "Test Visa",
  network: "Visa",
  segment: "Classic",
  annualFee: 100,
  targetSpendForWaiver: null,
  imageUrl: null,
  benefits: ["Benefit"],
  sourceUrl: "https://example.test/card",
  sourceCheckedAt: "2026-07-11",
  active: true,
  sortOrder: 1,
  theme: { background: "#000", accent: "#fff" },
};

test("catalog product and provider contracts accept canonical backend/frontend DTOs", () => {
  assert.deepEqual(catalogProductSchema.parse(product), product);
  assert.equal(catalogProviderListSchema.parse([{ providerCode: "TST", providerName: "Test Bank", products: [product] }]).length, 1);
  assert.throws(() => catalogProductSchema.parse({ ...product, presetId: "Legacy_ID" }));
  assert.throws(() => catalogProductSchema.parse({ ...product, sourceCheckedAt: "2026-02-30" }));
  assert.throws(() => catalogProductSchema.parse({ ...product, sourceCheckedAt: "31/07/2026" }));
  assert.throws(() => catalogProductSchema.parse({ ...product, sourceCheckedAt: "" }));
});
