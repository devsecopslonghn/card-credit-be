import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("REST route adapters do not acquire direct model dependencies", () => {
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const routeFiles = readdirSync(sourceRoot).filter((name) => name.endsWith("-routes.ts"));
  const directModelRoutes = routeFiles.filter((name) => {
    const source = readFileSync(`${sourceRoot}/${name}`, "utf8");
    return /from ["']mongoose["']|from ["']\.\/models\//.test(source) || /\b[A-Z][A-Za-z]+Model\.(?:find|findOne|findById|create|update|delete|exists)/.test(source);
  });
  assert.deepEqual(directModelRoutes, []);
});
