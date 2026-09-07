import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("browser mutations allow same-origin proxy traffic and reject cross-site origins", async () => {
  const app = buildApp({ isReady: () => true }, "silent");
  app.post("/mutation", async () => ({ ok: true }));
  const sameOrigin = await app.inject({ method: "POST", url: "/mutation", headers: { origin: "https://cards.example.test", "x-forwarded-host": "cards.example.test", "x-forwarded-proto": "https" } });
  assert.equal(sameOrigin.statusCode, 200);
  const crossOrigin = await app.inject({ method: "POST", url: "/mutation", headers: { origin: "https://evil.example.test", "x-forwarded-host": "cards.example.test", "x-forwarded-proto": "https" } });
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal(crossOrigin.json().error.code, "CSRF_ORIGIN_MISMATCH");
  const fetchMetadata = await app.inject({ method: "POST", url: "/mutation", headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(fetchMetadata.statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example.test" } })).headers["access-control-allow-origin"], undefined);
  await app.close();
});
