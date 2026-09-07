import assert from "node:assert/strict";
import test from "node:test";
import { financeCategoryInputSchema, financeCategoryListSchema } from "../src/index.js";

test("finance category uses one strict planning contract", () => {
  assert.deepEqual(financeCategoryInputSchema.parse({ name: " Food ", parentId: "parent-1" }), { name: "Food", parentId: "parent-1" });
  assert.deepEqual(financeCategoryListSchema.parse([{ id: "category-1", name: "FOOD", parentId: null, system: false }]), [{ id: "category-1", name: "FOOD", parentId: null, system: false }]);
  assert.throws(() => financeCategoryInputSchema.parse({ name: "Food", workspaceId: "attacker" }));
  assert.throws(() => financeCategoryListSchema.parse([{ id: "category-1", name: "FOOD", parentId: null, system: "false" }]));
});
