import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSources = await Promise.all([
  readFile(new URL("../src/services/account-service.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/financial-transaction-service.ts", import.meta.url), "utf8"),
]);

test("legacy McpMutationModel is not used by application command services", () => {
  const legacyCall = /McpMutationModel\./;
  for (const source of serviceSources) {
    assert.doesNotMatch(source, legacyCall);
  }
});
