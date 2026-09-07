import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createMcpServer } from "./tools.js";
import type { ServiceContext } from "../services/types/service-context.js";
import type { AuthRepository } from "../auth-repository.js";
import { createMcpContextProvider } from "./context.js";
import type { PreviewTokenCodec } from "./preview.js";
import type { McpWriterMode } from "./manifest.js";

const authorized = (request: FastifyRequest, token: string) => {
  const supplied = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
  return Boolean(token) && supplied.length === token.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
};

export const registerMcpHttp = (app: FastifyInstance, ctx: ServiceContext, token: string, users?: Pick<AuthRepository, "findUserById">, previewCodec?: PreviewTokenCodec, writerMode: McpWriterMode = "read") => {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const handle = async (request: FastifyRequest<{ Body: unknown }>, reply: import("fastify").FastifyReply) => {
    if (!authorized(request, token)) return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "MCP_UNAUTHORIZED" });
    const sessionId = request.headers["mcp-session-id"];
    let transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport && request.method === "POST" && isInitializeRequest(request.body)) {
      const created = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: (id) => { transports.set(id, created); }, onsessionclosed: (id) => { transports.delete(id); } });
      transport = created;
      await createMcpServer(createMcpContextProvider(ctx, users), previewCodec, undefined, writerMode).connect(transport);
    }
    if (!transport) return reply.code(400).send({ error: "MCP_SESSION_REQUIRED" });
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  };
  app.post<{ Body: unknown }>("/mcp", handle);
  app.get<{ Body: unknown }>("/mcp", handle);
  app.delete<{ Body: unknown }>("/mcp", handle);
};
