import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("health is live while readiness follows database state", async () => {
  let ready = false;
  const app = buildApp({ isReady: () => ready }, "silent");
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok" });
  const unavailable = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(unavailable.statusCode, 503);
  ready = true;
  const available = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(available.statusCode, 200);
  await app.close();
});
