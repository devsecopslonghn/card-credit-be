import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewTokenCodec, MCP_PREVIEW_TTL_MS } from "../src/mcp/preview.js";
import { PreviewConfirmationService } from "../src/services/preview-confirmation-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const binding = { workspaceId: "workspace-a", userId: "user-a", channel: "mcp" } as const;
const context: ServiceContext = { ...binding, role: "user", correlationId: "preview-test" };

test("preview token canonicalizes payloads and binds operation/context without raw payload", () => {
  let now = 1_700_000_000_000;
  const codec = createPreviewTokenCodec({ secret, now: () => now });
  const first = codec.issue("create_account", { nested: { b: 2, a: 1 }, note: "secret-note" }, binding);
  assert.match(first.previewId, /^[0-9a-f-]{36}$/i);
  assert.equal(first.expiresAt - now, MCP_PREVIEW_TTL_MS);
  assert.equal(first.expiresInSeconds, 300);
  assert.equal(first.confirmationToken.includes("secret-note"), false);
  assert.doesNotThrow(() => codec.verify(first.confirmationToken, "create_account", { note: "secret-note", nested: { a: 1, b: 2 } }, binding));
  assert.throws(() => codec.verify(first.confirmationToken, "create_account", { note: "secret-note", nested: { a: 1, b: 3 } }, binding), /mismatched|Invalid/);
  assert.throws(() => codec.verify(first.confirmationToken, "create_account", { note: "secret-note", nested: { a: 1, b: 2 } }, { ...binding, workspaceId: "workspace-b" }), /mismatched|Invalid/);
  assert.throws(() => codec.verify(first.confirmationToken, "other", { note: "secret-note", nested: { a: 1, b: 2 } }, binding), /mismatched|Invalid/);
  now += MCP_PREVIEW_TTL_MS;
  assert.deepEqual(codec.verify(first.confirmationToken, "create_account", { note: "secret-note", nested: { a: 1, b: 2 } }, binding), { previewId: first.previewId });
  const browserCodec = createPreviewTokenCodec({ secret, domain: "card-credit:browser-preview:v1", now: () => now });
  const browserToken = browserCodec.issue("create_account", { note: "secret-note", nested: { a: 1, b: 2 } }, binding).confirmationToken;
  assert.throws(() => codec.verify(browserToken, "create_account", { note: "secret-note", nested: { a: 1, b: 2 } }, binding), /Invalid confirmation token/);
  assert.throws(() => browserCodec.verify(first.confirmationToken, "create_account", { note: "secret-note", nested: { a: 1, b: 2 } }, binding), /Invalid confirmation token/);
});

test("preview token rejects unsupported payloads, malformed tokens and weak secrets", () => {
  assert.throws(() => createPreviewTokenCodec({ secret: "short" }), /at least 32/);
  const codec = createPreviewTokenCodec({ secret });
  assert.throws(() => codec.issue("op", { value: undefined }, binding), /Invalid preview payload/);
  assert.throws(() => codec.issue("op", { value: Number.NaN }, binding), /Invalid preview payload/);
  const token = codec.issue("op", { value: 1 }, binding).confirmationToken;
  assert.throws(() => codec.verify(`${token}.extra`, "op", { value: 1 }, binding), /Invalid confirmation token/);
  assert.throws(() => codec.verify(`${token.slice(0, -1)}x`, "op", { value: 1 }, binding), /Invalid confirmation token/);
});

test("preview persistence stores only hashes and a server preview identifier", async () => {
  const records: Array<Record<string, unknown>> = [];
  const service = new PreviewConfirmationService({ insert: async (record) => { records.push(record as unknown as Record<string, unknown>); } });
  const codec = createPreviewTokenCodec({ secret });
  const metadata = await service.issue(context, "create_account", { name: "private account" }, codec);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.previewId, metadata.previewId);
  assert.equal(typeof records[0]?.payloadHash, "string");
  assert.equal(typeof records[0]?.tokenHash, "string");
  assert.equal("confirmationToken" in records[0]!, false);
  assert.equal("payload" in records[0]!, false);
});
