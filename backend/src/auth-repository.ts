import mongoose from "mongoose";
import { ApiError } from "./errors.js";
import { AuthUserModel, PasswordResetTokenModel } from "./models/auth.js";

export type AuthUser = {
  id: string; email: string; passwordHash: string; role: "admin" | "user";
  workspaceId: string; displayName: string; active: boolean; lockedAt: Date | null; sessionVersion?: number;
};
export type ResetToken = { tokenHash: string; userId: string; email: string; expiresAt: Date; usedAt: Date | null };
export type UserListPage = { users: AuthUser[]; nextCursor: string | null; limit: number };
export type UserListPageOptions = { limit?: string; cursor?: string };
export interface AuthRepository {
  countUsers(): Promise<number>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  createUser(user: Omit<AuthUser, "id">): Promise<AuthUser>;
  upsertUser(user: Omit<AuthUser, "id">): Promise<AuthUser>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
  touchLogin(id: string): Promise<void>;
  listUsers(): Promise<AuthUser[]>;
  listUsersPage?(options: UserListPageOptions): Promise<UserListPage>;
  updateUser(id: string, update: Partial<Pick<AuthUser, "displayName" | "role" | "workspaceId">>): Promise<AuthUser | null>;
  createResetToken(token: ResetToken): Promise<void>;
  findResetToken(hash: string, now: Date): Promise<ResetToken | null>;
  consumeResetTokens(userId: string, now: Date): Promise<void>;
}

const toUser = (doc: Record<string, unknown> | null): AuthUser | null => doc ? ({
  id: String(doc._id), email: String(doc.email), passwordHash: String(doc.passwordHash),
  role: doc.role === "admin" ? "admin" : "user", workspaceId: String(doc.workspaceId),
  displayName: String(doc.displayName ?? ""), active: doc.active !== false,
  lockedAt: doc.lockedAt instanceof Date ? doc.lockedAt : null,
  sessionVersion: Number.isSafeInteger(doc.sessionVersion) && Number(doc.sessionVersion) >= 0 ? Number(doc.sessionVersion) : 0,
}) : null;

export class MongoAuthRepository implements AuthRepository {
  async countUsers() { return AuthUserModel.countDocuments(); }
  async findUserByEmail(email: string) { return toUser(await AuthUserModel.findOne({ email }).select("+passwordHash").lean()); }
  async findUserById(id: string) { return !mongoose.isValidObjectId(id) ? null : toUser(await AuthUserModel.findOne({ _id: new mongoose.Types.ObjectId(id) }).select("+passwordHash").lean()); }
  async createUser(user: Omit<AuthUser, "id">) {
    const normalized = { ...user, sessionVersion: user.sessionVersion ?? 0 };
    const result = await AuthUserModel.create(normalized);
    return { ...normalized, id: String(result._id) };
  }
  async upsertUser(user: Omit<AuthUser, "id">) {
    const current = await AuthUserModel.findOne({ email: user.email }).select("+passwordHash").lean();
    const securityChanged = Boolean(current && (current.passwordHash !== user.passwordHash || current.role !== user.role || current.workspaceId !== user.workspaceId));
    await AuthUserModel.updateOne({ email: user.email }, { $set: { ...user }, $setOnInsert: { lastLoginAt: null, sessionVersion: 0 }, ...(securityChanged ? { $inc: { sessionVersion: 1 } } : {}) }, { upsert: true, runValidators: true });
    return (await this.findUserByEmail(user.email))!;
  }
  async updatePassword(id: string, passwordHash: string) { await AuthUserModel.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { passwordHash, passwordChangedAt: new Date(), lastLoginAt: null }, $inc: { sessionVersion: 1 } }, { runValidators: true }); }
  async touchLogin(id: string) { await AuthUserModel.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { lastLoginAt: new Date() } }); }
  async listUsers() { return (await AuthUserModel.find().select("+passwordHash").sort({ email: 1 }).lean()).map(toUser).filter((user): user is AuthUser => user !== null); }
  async listUsersPage(options: UserListPageOptions = {}) {
    const limit = Math.min(Math.max(Number.parseInt(options.limit ?? "100", 10) || 100, 1), 100);
    const query: Record<string, unknown> = {};
    if (options.cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")) as { email?: unknown; id?: unknown };
        if (typeof parsed.email !== "string" || !parsed.email || typeof parsed.id !== "string" || !mongoose.isValidObjectId(parsed.id)) throw new Error("invalid cursor");
        query.$or = [{ email: { $gt: parsed.email } }, { email: parsed.email, _id: { $gt: new mongoose.Types.ObjectId(parsed.id) } }];
      } catch {
        throw new ApiError(400, "INVALID_USER_CURSOR", "Cursor người dùng không hợp lệ.");
      }
    }
    const rows = await AuthUserModel.find(query).select("+passwordHash").sort({ email: 1, _id: 1 }).limit(limit + 1).lean();
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasNext && last ? Buffer.from(JSON.stringify({ email: last.email, id: String(last._id) }), "utf8").toString("base64url") : null;
    return { users: page.map(toUser).filter((user): user is AuthUser => user !== null), nextCursor, limit };
  }
  async updateUser(id: string, update: Partial<Pick<AuthUser, "displayName" | "role" | "workspaceId">>) { const securityChanged = update.role !== undefined || update.workspaceId !== undefined; return toUser(await AuthUserModel.findOneAndUpdate({ _id: new mongoose.Types.ObjectId(id) }, { $set: { ...update }, ...(securityChanged ? { $inc: { sessionVersion: 1 } } : {}) }, { returnDocument: "after", runValidators: true }).select("+passwordHash").lean()); }
  async createResetToken(token: ResetToken) { await PasswordResetTokenModel.create(token); }
  async findResetToken(tokenHash: string, now: Date) { return await PasswordResetTokenModel.findOne({ tokenHash, usedAt: null, expiresAt: { $gt: now } }).select("+tokenHash").lean() as ResetToken | null; }
  async consumeResetTokens(userId: string, now: Date) { await PasswordResetTokenModel.updateMany({ userId, usedAt: null }, { $set: { usedAt: now } }); }
}
