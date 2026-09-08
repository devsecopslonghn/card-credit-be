import assert from "node:assert/strict";
import test from "node:test";
import { toBudgetStatusDto } from "../src/services/finance-budget-service.js";

const budget = { _id: "budget-1", categoryId: "food", limitAmount: 1_000_000, warningPercent: 80 };

test("budget status DTO calculates authoritative usage, remaining and status", () => {
  assert.deepEqual(toBudgetStatusDto(budget, "2026-08", 500_000), {
    id: "budget-1", month: "2026-08", categoryId: "food", limitAmount: 1_000_000,
    usedAmount: 500_000, remainingAmount: 500_000, usagePercent: 50, status: "SAFE",
  });
  assert.equal(toBudgetStatusDto(budget, "2026-08", 850_000).status, "WARNING");
  assert.equal(toBudgetStatusDto(budget, "2026-08", 1_200_000).remainingAmount, 0);
  assert.equal(toBudgetStatusDto(budget, "2026-08", 1_200_000).status, "EXCEEDED");
});
