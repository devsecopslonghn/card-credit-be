import test from "node:test";
import assert from "node:assert/strict";
import { mergeAccountsInputSchema } from "../src/index.js";

test("merge input requires distinct sources and a target", () => {
  assert.throws(() => mergeAccountsInputSchema.parse({ sourceAccountIds: ["a", "a"] }));
  assert.deepEqual(mergeAccountsInputSchema.parse({ sourceAccountIds: ["a"], targetAccountId: "t" }), { sourceAccountIds: ["a"], targetAccountId: "t", keepTargetAsCash: false });
});

test("merge input supports creating a CASH target and optimistic versioning", () => {
  assert.deepEqual(mergeAccountsInputSchema.parse({ sourceAccountIds: ["a", "b"], targetName: "Unified cash", keepTargetAsCash: true, expectedVersion: 3 }), { sourceAccountIds: ["a", "b"], targetName: "Unified cash", keepTargetAsCash: true, expectedVersion: 3 });
});
