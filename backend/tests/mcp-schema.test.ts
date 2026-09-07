import assert from "node:assert/strict";
import test from "node:test";
import { reportDateRangeSchema, reportQueryInputSchema, reportQuerySchema } from "@card-credit/contracts";
import { mcpToolManifest } from "../src/mcp/manifest.js";

test("MCP financial summary exposes canonical date, owner and calendar filters", () => {
  assert.deepEqual(reportDateRangeSchema.parse({ from: "2026-08-01", to: "2026-08-31" }), {
    from: "2026-08-01",
    to: "2026-08-31",
  });
  const definition = mcpToolManifest.find(({ name }) => name === "get_personal_finance_summary");
  assert.equal(definition?.inputSchema.from, reportQueryInputSchema.shape.from);
  assert.equal(definition?.inputSchema.owner, reportQueryInputSchema.shape.owner);
  assert.equal(definition?.inputSchema.year, reportQueryInputSchema.shape.year);
  assert.equal(definition?.inputSchema.month, reportQueryInputSchema.shape.month);
  assert.deepEqual(reportQuerySchema.parse({ year: "2026", month: "08", owner: "Tôi" }), { year: "2026", month: "08", owner: "Tôi" });
  assert.throws(() => reportDateRangeSchema.parse({ from: "2026-02-30", to: "2026-03-01" }));
  assert.throws(() => reportDateRangeSchema.parse({ from: "2026-09-01", to: "2026-08-31" }));
});
