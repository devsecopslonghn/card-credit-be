import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loads safe runtime defaults", () => {
  const config = loadConfig({
    MONGODB_URI: "mongodb://127.0.0.1/card-credit-test",
    AUTH_SECRET: "01234567890123456789012345678901",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3001);
  assert.equal(config.sessionMaxAgeMs, 28_800_000);
  assert.equal(config.mcpWriterMode, "read");
});

test("rejects missing or short secrets", () => {
  assert.throws(() => loadConfig({ MONGODB_URI: "mongodb://127.0.0.1/test" }), /AUTH_SECRET is required/);
  assert.throws(() => loadConfig({ MONGODB_URI: "mongodb://127.0.0.1/test", AUTH_SECRET: "short" }), /at least 32/);
  assert.throws(() => loadConfig({ MONGODB_URI: "mongodb://127.0.0.1/test", AUTH_SECRET: "01234567890123456789012345678901", AUTH_SESSION_MAX_AGE_MS: "1000" }), /AUTH_SESSION_MAX_AGE_MS/);
});

test("MCP requires a dedicated preview secret only when remote MCP is enabled", () => {
  const base = { MONGODB_URI: "mongodb://127.0.0.1/test", AUTH_SECRET: "01234567890123456789012345678901", MCP_HTTP_TOKEN: "http-token" };
  assert.throws(() => loadConfig(base), /MCP_PREVIEW_SECRET/);
  assert.throws(() => loadConfig({ ...base, MCP_PREVIEW_SECRET: "short" }), /MCP_PREVIEW_SECRET/);
  assert.equal(loadConfig({ ...base, MCP_PREVIEW_SECRET: "01234567890123456789012345678902" }).mcpPreviewSecret, "01234567890123456789012345678902");
  assert.equal(loadConfig({ MONGODB_URI: base.MONGODB_URI, AUTH_SECRET: base.AUTH_SECRET }).mcpPreviewSecret, undefined);
});

test("MCP writer mode fails closed to read-only and rejects unknown values", () => {
  const base = { MONGODB_URI: "mongodb://127.0.0.1/test", AUTH_SECRET: "01234567890123456789012345678901", MCP_HTTP_TOKEN: "http-token", MCP_PREVIEW_SECRET: "01234567890123456789012345678902" };
  assert.equal(loadConfig(base).mcpWriterMode, "read");
  assert.equal(loadConfig({ ...base, MCP_OLD_WRITER_FENCED: "true" }).mcpWriterMode, "read");
  assert.equal(loadConfig({ ...base, MCP_WRITER_MODE: "write", MCP_OLD_WRITER_FENCED: "true" }).mcpWriterMode, "write");
  assert.equal(loadConfig(base).mcpOldWriterFenced, false);
  assert.throws(() => loadConfig({ ...base, MCP_WRITER_MODE: "write" }), /MCP_OLD_WRITER_FENCED/);
  assert.throws(() => loadConfig({ ...base, MCP_WRITER_MODE: "admin" }), /MCP_WRITER_MODE/);
});
