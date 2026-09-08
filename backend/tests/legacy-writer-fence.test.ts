import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serviceSources = await Promise.all([
  readFile(new URL("../src/services/account-service.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/financial-transaction-service.ts", import.meta.url), "utf8"),
]);

test("legacy McpMutationModel remains read-only in application services", () => {
  const legacyWriterCall = /McpMutationModel\.(create|insert|update|updateOne|findOneAndUpdate|replaceOne|deleteOne|deleteMany|bulkWrite)\s*\(/;
  for (const source of serviceSources) {
    assert.doesNotMatch(source, legacyWriterCall);
    assert.match(source, /McpMutationModel\.findOne\s*\(/);
  }
});
