import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { MCP_TOOL_INVENTORY, mcpToolManifest, mcpToolNamesForMode } from "../src/mcp/manifest.js";
import { mcpToolNamesForDocs } from "../src/api-docs.js";
import { createMcpServer } from "../src/mcp/tools.js";
import { registerMcpHttp } from "../src/mcp/http.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const readContext: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "mcp", correlationId: "http-test" };
const mcpToken = "mcp-http-test-token";

const eventData = (body: string) => {
  const line = body.split("\n").find((value) => value.startsWith("data: "));
  assert.ok(line, "MCP response did not contain an SSE data event");
  return JSON.parse(line.slice("data: ".length)) as { result?: { tools?: Array<{ name: string }> } };
};

test("MCP inventory is unique and exposes only registered tool names", () => {
  assert.equal(new Set(MCP_TOOL_INVENTORY).size, MCP_TOOL_INVENTORY.length);
  assert.deepEqual(MCP_TOOL_INVENTORY, mcpToolManifest.map(({ name }) => name));
  assert.equal(mcpToolManifest.filter(({ kind }) => kind === "preview").length, 5);
  assert.equal(mcpToolManifest.filter(({ kind }) => kind === "confirm").length, 5);
  for (const preview of mcpToolManifest.filter(({ kind }) => kind === "preview")) {
    assert.ok(preview.operation);
    assert.equal(mcpToolManifest.some((candidate) => candidate.kind === "confirm" && candidate.operation === preview.operation), true);
  }
  for (const definition of mcpToolManifest) {
    assert.ok(definition.description);
    assert.equal("userId" in definition.inputSchema, false);
    assert.equal("workspaceId" in definition.inputSchema, false);
    assert.equal("role" in definition.inputSchema, false);
  }
  assert.deepEqual(mcpToolNamesForDocs("write"), MCP_TOOL_INVENTORY);
  assert.deepEqual(mcpToolNamesForMode(), mcpToolNamesForDocs());
  assert.equal(mcpToolNamesForMode().some((name) => name.startsWith("preview_") || name.startsWith("confirm_")), false);
});

test("MCP tools/list matches the canonical manifest", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "inventory-test", version: "1.0.0" });
  const server = createMcpServer({ workspaceId: "w1", userId: "u1", role: "user", channel: "mcp", correlationId: "test" }, undefined, undefined, "write");
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.listTools();
  assert.deepEqual(result.tools.map(({ name }) => name), MCP_TOOL_INVENTORY);
  assert.equal(result.tools.length, mcpToolManifest.length);
  await client.close();
  await server.close();
});

test("MCP read mode registers only query tools and documents the same inventory", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "read-mode-test", version: "1.0.0" });
  const server = createMcpServer({ workspaceId: "w1", userId: "u1", role: "user", channel: "mcp", correlationId: "test" }, undefined, undefined, "read");
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.listTools();
  const expected = mcpToolNamesForMode("read");
  assert.deepEqual(result.tools.map(({ name }) => name), expected);
  assert.equal(result.tools.some(({ name }) => name.startsWith("preview_") || name.startsWith("confirm_")), false);
  assert.deepEqual(mcpToolNamesForDocs("read"), expected);
  await client.close();
  await server.close();
});

test("MCP HTTP read mode exposes only query tools after an authenticated initialize", async () => {
  const app = Fastify({ logger: false });
  registerMcpHttp(app, readContext, mcpToken, undefined, undefined, "read");
  await app.ready();

  const unauthorized = await app.inject({ method: "POST", url: "/mcp", headers: { accept: "application/json, text/event-stream" }, payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } });
  assert.equal(unauthorized.statusCode, 401);

  const missingSession = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${mcpToken}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  assert.equal(missingSession.statusCode, 400);
  assert.deepEqual(missingSession.json(), { error: "MCP_SESSION_REQUIRED" });

  const initialize = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${mcpToken}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "read-test", version: "1.0.0" } } },
  });
  assert.equal(initialize.statusCode, 200);
  const sessionId = initialize.headers["mcp-session-id"];
  assert.equal(typeof sessionId, "string");
  eventData(initialize.body);

  const listed = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${mcpToken}`, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-session-id": String(sessionId) },
    payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  assert.equal(listed.statusCode, 200);
  const tools = eventData(listed.body).result?.tools ?? [];
  assert.deepEqual(tools.map(({ name }) => name), mcpToolNamesForMode("read"));
  assert.equal(tools.some(({ name }) => name.startsWith("preview_") || name.startsWith("confirm_")), false);
  await app.close();
});
