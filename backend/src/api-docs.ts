import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { OpenAPIV3 } from "openapi-types";
import { mcpToolNamesForMode, type McpWriterMode } from "./mcp/manifest.js";
import { REST_ENDPOINTS, type RestSecurity } from "./rest-manifest.js";

export const mcpToolNamesForDocs = (writerMode: McpWriterMode = "read") => mcpToolNamesForMode(writerMode);

type Security = Array<Record<string, string[]>>;
type AuthorizationMetadata = { mechanism: "cookie" | "bearer" | "path-token"; requiredRole?: "admin"; purpose?: "bootstrap" | "calendar-feed" };
const auth: Security = [{ cookieAuth: [] }];
const bearer: Security = [{ bearerAuth: [] }];
const operation = (summary: string, security: Security = auth, authorization?: AuthorizationMetadata) => ({ summary, security, ...(authorization ? { "x-authorization": authorization } : {}), responses: { "200": { description: "Success" }, "400": { description: "Invalid request" }, "401": { description: "Unauthenticated" }, "403": { description: "Forbidden" }, "404": { description: "Not found" }, "409": { description: "Conflict" }, "500": { description: "Unexpected error" } } });
const paths: Record<string, Record<string, unknown>> = {};
const add = (method: string, path: string, summary: string, security = auth, authorization?: AuthorizationMetadata) => { paths[path] ??= {}; paths[path][method] = operation(summary, security, authorization); };

const securityFor = (security: RestSecurity): Security => security === "public" || security === "calendar-token" ? [] : security === "bearer" ? bearer : auth;
const authorizationFor = (security: RestSecurity): AuthorizationMetadata | undefined => security === "admin" ? { mechanism: "cookie", requiredRole: "admin" } : security === "bearer" ? { mechanism: "bearer", purpose: "bootstrap" } : security === "calendar-token" ? { mechanism: "path-token", purpose: "calendar-feed" } : undefined;
for (const endpoint of REST_ENDPOINTS) add(endpoint.method, endpoint.path, endpoint.summary, securityFor(endpoint.security), authorizationFor(endpoint.security));
add("post", "/mcp", "MCP Streamable HTTP endpoint", bearer, { mechanism: "bearer" });

export const registerApiDocs = async (app: FastifyInstance, writerMode: McpWriterMode = "read") => {
  await app.register(swagger, { mode: "static", specification: { path: "", document: ({
    openapi: "3.0.3", info: { title: "Card Credit API", version: "0.1.0", description: "REST API and remote MCP endpoint for Card Credit." },
    tags: [{ name: "REST API" }, { name: "MCP" }], servers: [{ url: "/", description: "Current origin" }],
    components: { securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "card_credit_session" }, bearerAuth: { type: "http", scheme: "bearer" } } }, paths,
    "x-mcp": { transport: "Streamable HTTP", endpoint: "/mcp", authentication: "Authorization: Bearer <MCP_HTTP_TOKEN>", fixedContext: ["MCP_USER_ID", "MCP_WORKSPACE_ID"], tools: mcpToolNamesForDocs(writerMode), writerMode, mutationPolicy: writerMode === "write" ? "Preview -> explicit confirmation -> idempotent confirm" : "Read-only; mutation tools are not registered", auditStatus: "PENDING" },
  } as unknown as OpenAPIV3.Document) } });
  await app.register(swaggerUi, { routePrefix: "/docs", staticCSP: true, uiConfig: { docExpansion: "list", deepLinking: true } });
};
