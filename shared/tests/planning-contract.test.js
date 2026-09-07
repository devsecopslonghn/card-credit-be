import assert from "node:assert/strict";
import test from "node:test";
import { budgetStatusListSchema } from "../src/index.js";

const output = { id: "budget-1", month: "2026-08", categoryId: "food", limitAmount: 2_000_000, usedAmount: 500_000, remainingAmount: 1_500_000, usagePercent: 25, status: "SAFE" };

test("budget status uses one canonical Planning read contract", () => {
  assert.deepEqual(budgetStatusListSchema.parse([output]), [output]);
  assert.throws(() => budgetStatusListSchema.parse([{ ...output, month: "2026-13" }]));
  assert.throws(() => budgetStatusListSchema.parse([{ ...output, usedAmount: Number.MAX_SAFE_INTEGER + 1 }]));
  assert.throws(() => budgetStatusListSchema.parse([{ ...output, remainingAmount: -1 }]));
});
