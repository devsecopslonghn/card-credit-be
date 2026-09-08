import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const firstHeader = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value?.split(",")[0]?.trim();
const expectedOrigin = (request: FastifyRequest) => {
  const host = firstHeader(request.headers["x-forwarded-host"]) ?? request.headers.host;
  if (!host) return null;
  const protocol = firstHeader(request.headers["x-forwarded-proto"]) ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
};

export const assertSameOriginMutation = (request: FastifyRequest) => {
  if (!unsafeMethods.has(request.method)) return;
  if (request.headers["sec-fetch-site"] === "cross-site") throw new ApiError(403, "CSRF_ORIGIN_MISMATCH", "Nguồn request không hợp lệ.");
  const origin = request.headers.origin;
  if (!origin) return;
  const expected = expectedOrigin(request);
  let normalized: string;
  try { normalized = new URL(origin).origin; } catch { throw new ApiError(403, "CSRF_ORIGIN_MISMATCH", "Nguồn request không hợp lệ."); }
  if (!expected || normalized !== expected) throw new ApiError(403, "CSRF_ORIGIN_MISMATCH", "Nguồn request không hợp lệ.");
};

export const installBrowserSecurity = (app: FastifyInstance) => {
  app.addHook("onRequest", async (request) => { assertSameOriginMutation(request); });
};
