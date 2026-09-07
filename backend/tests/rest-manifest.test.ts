import assert from "node:assert/strict";
import test from "node:test";
import { REST_ENDPOINTS, parseFastifyRouteInventory, restEndpointKey } from "../src/rest-manifest.js";

test("REST documentation inventory has unique method/path entries and explicit security", () => {
  const keys = REST_ENDPOINTS.map(restEndpointKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(REST_ENDPOINTS.length >= 40);
  assert.equal(REST_ENDPOINTS.every(({ security }) => ["public", "session", "admin", "bearer", "calendar-token"].includes(security)), true);
  assert.equal(REST_ENDPOINTS.some(({ path }) => path === "/mcp"), false);
  assert.equal(REST_ENDPOINTS.filter(({ security }) => security === "admin").every(({ path }) => path.startsWith("/api/admin/")), true);
  assert.equal(REST_ENDPOINTS.find(({ path }) => path.includes("feed/"))?.security, "calendar-token");
});

test("Fastify route parser normalizes parameter names without hiding static paths", () => {
  const printed = `├── /api/cards (GET, HEAD)\n│   └── /:id|:cardId (GET, PUT)\n│       └── /statements/:statementId (GET)\n└── /health (GET, HEAD)`;
  assert.deepEqual(parseFastifyRouteInventory(printed), [
    "GET /api/cards",
    "GET /api/cards/{param}",
    "GET /api/cards/{param}/statements/{param}",
    "GET /health",
    "PUT /api/cards/{param}",
  ]);
});
