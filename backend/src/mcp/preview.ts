import crypto from "node:crypto";
import { canonicalPayloadHash } from "../command-hash.js";
export { canonicalPayloadHash } from "../command-hash.js";

export const MCP_PREVIEW_TTL_MS = 300_000;
export const MCP_PREVIEW_TTL_SECONDS = MCP_PREVIEW_TTL_MS / 1000;
const PREVIEW_SCHEMA_VERSION = "preview.v2";

export type PreviewBinding = { workspaceId: string; userId: string; channel: string };
type PreviewClaims = { version: string; previewId: string; operation: string; payloadHash: string; contextHash: string; issuedAt: number; expiresAt: number };

const normalizedBinding = (binding: PreviewBinding): PreviewBinding => {
  const value = { workspaceId: binding.workspaceId?.trim(), userId: binding.userId?.trim(), channel: binding.channel?.trim() };
  if (Object.values(value).some((item) => !item)) throw new Error("Invalid preview context");
  return value;
};
const previewPayloadHash = (payload: unknown) => {
  try { return canonicalPayloadHash(payload); } catch { throw new Error("Invalid preview payload"); }
};
const contextHash = (binding: PreviewBinding) => canonicalPayloadHash(normalizedBinding(binding));
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const safeEqual = (left: string, right: string) => { const a = Buffer.from(left, "utf8"); const b = Buffer.from(right, "utf8"); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sign = (secret: string, body: string, domain: string) => crypto.createHmac("sha256", secret).update(`${domain}:${body}`).digest("base64url");
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

export type PreviewTokenCodec = {
  ttlSeconds: number;
  issue(operation: string, payload: unknown, binding: PreviewBinding): { previewId: string; confirmationToken: string; expiresAt: number; expiresInSeconds: number };
  verify(token: string, operation: string, payload: unknown, binding: PreviewBinding): { previewId: string };
};

export const createPreviewTokenCodec = (options: { secret: string; domain?: string; now?: () => number; ttlMs?: number }): PreviewTokenCodec => {
  const secret = options.secret.trim();
  if (secret.length < 32) throw new Error("MCP_PREVIEW_SECRET must contain at least 32 characters");
  const ttlMs = options.ttlMs ?? MCP_PREVIEW_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 1_800_000) throw new Error("Preview TTL must be between 1000 and 1800000 milliseconds");
  const now = options.now ?? Date.now;
  const domain = options.domain?.trim() || "card-credit:mcp-preview:v1";
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(domain)) throw new Error("Preview domain is invalid");
  return {
    ttlSeconds: Math.floor(ttlMs / 1000),
    issue(operation, payload, binding) {
      const issuedAt = now();
      const claims: PreviewClaims = { version: PREVIEW_SCHEMA_VERSION, previewId: crypto.randomUUID(), operation: operation.trim(), payloadHash: previewPayloadHash(payload), contextHash: contextHash(binding), issuedAt, expiresAt: issuedAt + ttlMs };
      const body = encode(claims);
      return { previewId: claims.previewId, confirmationToken: `${body}.${sign(secret, body, domain)}`, expiresAt: claims.expiresAt, expiresInSeconds: Math.floor(ttlMs / 1000) };
    },
    verify(token, operation, payload, binding) {
      const [body, providedSignature, ...extra] = token.split(".");
      if (!body || !providedSignature || extra.length || !safeEqual(providedSignature, sign(secret, body, domain))) throw new Error("Invalid confirmation token");
      let claims: PreviewClaims;
      try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PreviewClaims; } catch { throw new Error("Invalid confirmation token"); }
      const current = now();
      if (claims.version !== PREVIEW_SCHEMA_VERSION || typeof claims.previewId !== "string" || !/^[0-9a-f-]{36}$/i.test(claims.previewId) || typeof claims.operation !== "string" || claims.operation !== operation.trim() || !Number.isFinite(claims.issuedAt) || !Number.isFinite(claims.expiresAt) || claims.issuedAt < 0 || claims.issuedAt > current + 60_000 || claims.expiresAt - claims.issuedAt !== ttlMs || !isHash(claims.payloadHash) || !isHash(claims.contextHash) || !safeEqual(claims.payloadHash, previewPayloadHash(payload)) || !safeEqual(claims.contextHash, contextHash(binding))) throw new Error("Expired or mismatched confirmation token");
      // Expiry is enforced by the persistent command guard after it checks for
      // a completed idempotency receipt, so a lost response can still replay
      // safely after the short token TTL.
      return { previewId: claims.previewId };
    },
  };
};

export const confirmationTokenHash = (token: string) => crypto.createHash("sha256").update(token, "utf8").digest("hex");
