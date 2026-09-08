import crypto from "node:crypto";

const normalizeJson = (value: unknown, seen = new Set<object>()): unknown => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid command payload");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("Invalid command payload");
    seen.add(value);
    const result = value.map((item) => normalizeJson(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error("Invalid command payload");
    seen.add(object);
    const result = Object.fromEntries(Object.keys(object).sort().map((key) => [key, normalizeJson(object[key], seen)]));
    seen.delete(object);
    return result;
  }
  throw new Error("Invalid command payload");
};

export const canonicalJson = (value: unknown) => JSON.stringify(normalizeJson(value));
export const canonicalPayloadHash = (value: unknown) => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");

/** Hash format used by the pre-contract McpMutationModel receipts.
 *
 * Keep this read-only compatibility path until all existing receipts have
 * expired/been migrated. New receipts must always use canonicalPayloadHash.
 */
export const legacyPayloadHash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const payloadHashMatches = (stored: unknown, canonicalHash: string, legacyHash: string) => stored === canonicalHash || stored === legacyHash;
