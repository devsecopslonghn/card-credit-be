import mongoose from "mongoose";
import { ApiError } from "../errors.js";

type Data = Record<string, unknown>;
type AuditFilters = { event?: string; userId?: string; email?: string; resourceType?: string; resourceId?: string; limit?: string; cursor?: string };

export type AuditLogRepository = {
  list(query: Data, limit: number): Promise<Data[]>;
};

const auditLogRepository: AuditLogRepository = {
  list: async (query, limit) => mongoose.connection.collection("authauditlogs").find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray() as Promise<Data[]>,
};

const boundedLimit = (value: unknown) => Math.min(Math.max(Number.parseInt(typeof value === "string" ? value : "50", 10) || 50, 1), 100);
const encodeCursor = (value: Data) => {
  const createdAt = value.createdAt instanceof Date ? value.createdAt.toISOString() : String(value.createdAt ?? "");
  const id = String(value._id ?? "");
  if (!createdAt || !id) return null;
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString("base64url");
};
const decodeCursor = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || !parsed.id) {
      throw new Error("invalid cursor");
    }
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new ApiError(400, "INVALID_AUDIT_CURSOR", "Cursor audit không hợp lệ.");
  }
};

export class AdminAuditService {
  static async list(filters: AuditFilters, repository: AuditLogRepository = auditLogRepository) {
    const limit = boundedLimit(filters.limit);
    const query: Data = {};
    if (filters.event) query.event = filters.event;
    if (filters.userId) query.userId = filters.userId;
    if (filters.email) query.email = filters.email.trim().toLowerCase();
    if (filters.resourceType) query["resource.type"] = filters.resourceType;
    if (filters.resourceId) query["resource.id"] = filters.resourceId;
    const cursor = decodeCursor(filters.cursor);
    if (cursor) query.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
    const logs = await repository.list(query, limit + 1);
    const hasNext = logs.length > limit;
    const page = hasNext ? logs.slice(0, limit) : logs;
    const nextCursor = hasNext ? encodeCursor(page[page.length - 1] as Data) : null;
    return { logs: page.map(({ _id, ...log }) => ({ id: String(_id), ...log })), filters: query, limit, nextCursor };
  }
}
