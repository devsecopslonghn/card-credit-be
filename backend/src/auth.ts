import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";

export type Session = { userId: string; email: string; role: string; workspaceId: string; sessionVersion?: number };
export const AUTH_COOKIE_NAME = "card_credit_session";
export const DEFAULT_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const sessionMaxAgeMs = (value = process.env.AUTH_SESSION_MAX_AGE_MS): number => {
  const parsed = Number(value ?? DEFAULT_SESSION_MAX_AGE_MS);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 30 * 24 * 60 * 60 * 1000) {
    throw new Error("AUTH_SESSION_MAX_AGE_MS must be an integer between 60000 and 2592000000 milliseconds");
  }
  return parsed;
};
export const signSession = (session: Session, secret: string, issuedAt = Date.now()) => {
  const payload = Buffer.from(JSON.stringify({ ...session, sessionVersion: session.sessionVersion ?? 0, issuedAt })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}`;
};
export const sessionCookie = (value: string, maxAge?: number) =>
  `${AUTH_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;
export const sessionFromRequest = (request: FastifyRequest, secret: string, maxAgeMs = sessionMaxAgeMs()): Session => {
  const value = request.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${AUTH_COOKIE_NAME}=`))?.slice(AUTH_COOKIE_NAME.length + 1);
  const [payload, signature] = value?.split(".") ?? [];
  if (!payload || !signature) throw new ApiError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ApiError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập.");
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session & { issuedAt?: unknown };
    const now = Date.now();
    if (typeof session.issuedAt !== "number" || !Number.isSafeInteger(session.issuedAt) || session.issuedAt > now + 5 * 60_000 || now - session.issuedAt > maxAgeMs) throw new Error("expired session");
    const sessionVersion = (session as { sessionVersion?: unknown }).sessionVersion ?? 0;
    if (!session.userId || !session.workspaceId || !session.role || typeof sessionVersion !== "number" || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0) throw new Error("invalid session");
    return { userId: session.userId, email: session.email, role: session.role, workspaceId: session.workspaceId, sessionVersion };
  } catch { throw new ApiError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập."); }
};
export const requireAdmin = (request: FastifyRequest, secret: string): Session => {
  const session = sessionFromRequest(request, secret);
  if (session.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
  return session;
};
