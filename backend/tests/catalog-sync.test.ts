import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("catalog sync module is a read-only baseline loader", () => {
  const source = readFileSync(new URL("../src/catalog-sync.ts", import.meta.url), "utf8");
  assert.match(source, /readCatalogFile/);
  assert.doesNotMatch(source, /mongoose|updateOne|syncCatalogFromFile/);
});
