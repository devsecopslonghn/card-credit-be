import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { registerAuthRoutes } from "../src/auth-routes.js";
import { sessionCookie, sessionFromRequest, signSession } from "../src/auth.js";
import type { AuthRepository, AuthUser, ResetToken } from "../src/auth-repository.js";
import type { PasswordResetEmail } from "../src/mail-service.js";

class MemoryAuth implements AuthRepository {
  users: AuthUser[] = []; tokens: ResetToken[] = [];
  async countUsers() { return this.users.length; }
  async findUserByEmail(email: string) { return this.users.find((u) => u.email === email) ?? null; }
  async findUserById(id: string) { return this.users.find((u) => u.id === id) ?? null; }
  async createUser(user: Omit<AuthUser, "id">) { const created = { ...structuredClone(user), id: String(this.users.length + 1) }; this.users.push(created); return created; }
  async upsertUser(user: Omit<AuthUser, "id">) { const current = await this.findUserByEmail(user.email); if (current) { Object.assign(current, structuredClone(user)); return current; } return this.createUser(user); }
  async updatePassword(id: string, hash: string) { const user = (await this.findUserById(id))!; user.passwordHash = hash; user.sessionVersion = (user.sessionVersion ?? 0) + 1; }
  async touchLogin() {}
  async listUsers() { return structuredClone(this.users).sort((a, b) => a.email.localeCompare(b.email)); }
  async updateUser(id: string, update: Partial<Pick<AuthUser, "displayName" | "role" | "workspaceId">>) { const user = await this.findUserById(id); if (!user) return null; if (update.role !== undefined || update.workspaceId !== undefined) user.sessionVersion = (user.sessionVersion ?? 0) + 1; Object.assign(user, update); return structuredClone(user); }
  async createResetToken(token: ResetToken) { this.tokens.push(structuredClone(token)); }
  async findResetToken(hash: string, now: Date) { return this.tokens.find((t) => t.tokenHash === hash && !t.usedAt && t.expiresAt > now) ?? null; }
  async consumeResetTokens(userId: string, now: Date) { this.tokens.filter((t) => t.userId === userId && !t.usedAt).forEach((t) => { t.usedAt = now; }); }
}
const secret = "01234567890123456789012345678901";

test("register, me, logout, login, and reset preserve cookie contracts", async () => {
  const repository = new MemoryAuth(); const events: string[] = [];
  const app = buildApp({ isReady: () => true }, "silent");
  registerAuthRoutes(app, { repository, secret, returnResetToken: true, audit: async (event) => { events.push(event); } });
  const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "admin@example.test", password: "valid-pass" } });
  assert.equal(registered.statusCode, 201); const cookie = String(registered.headers["set-cookie"]); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
const me = await app.inject({ url: "/api/auth/me", headers: { cookie } }); assert.equal(me.statusCode, 200); assert.equal(me.json().user.role, "admin"); assert.deepEqual(Object.keys(me.json().user).sort(), ["email", "role", "workspaceId"]);
  assert.match(me.json().user.workspaceId, /^personal-[a-f0-9]{24}$/);
  const rejectedWorkspace = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "other@example.test", password: "valid-pass", workspaceId: "cross-workspace" } });
  assert.equal(rejectedWorkspace.statusCode, 400); assert.equal(rejectedWorkspace.json().error.code, "WORKSPACE_SELECTION_NOT_ALLOWED");
  repository.users[0]!.active = false; assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode, 401); repository.users[0]!.active = true;
  const logout = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } }); assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.test", password: "valid-pass" } }); assert.equal(login.statusCode, 200);
  const forgot = await app.inject({ method: "POST", url: "/api/auth/forgot-password", headers: { "x-forwarded-host": "test.local", "x-forwarded-proto": "https" }, payload: { email: "admin@example.test" } }); assert.match(forgot.json().resetLink, /^https:\/\/test\.local\/forgot-password\?token=/); const token = new URL(forgot.json().resetLink).searchParams.get("token")!;
  const reset = await app.inject({ method: "POST", url: "/api/auth/reset-password", payload: { token, password: "new-valid-pass" } }); assert.equal(reset.statusCode, 200);
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.test", password: "new-valid-pass" } })).statusCode, 200);
  assert.ok(events.includes("LOGIN_SUCCESS")); assert.ok(events.includes("PASSWORD_RESET_COMPLETED")); await app.close();
});

test("auth me uses one authoritative user lookup and ignores cookie identity fields", async () => {
  const repository = new MemoryAuth();
  await repository.createUser({ email: "authoritative@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-authoritative", displayName: "Authoritative", active: true, lockedAt: null });
  let lookups = 0;
  const originalFindUserById = repository.findUserById.bind(repository);
  repository.findUserById = async (id) => { lookups += 1; return originalFindUserById(id); };
  const app = buildApp({ isReady: () => true }, "silent");
  registerAuthRoutes(app, { repository, secret });
  const cookie = sessionCookie(signSession({ userId: "1", email: "stale@example.test", role: "admin", workspaceId: "workspace-authoritative" }, secret));
  const response = await app.inject({ url: "/api/auth/me", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().user, { email: "authoritative@example.test", role: "user", workspaceId: "workspace-authoritative" });
  assert.equal(lookups, 1);
  await app.close();
});

test("auth me rejects a session after an authoritative role or workspace change", async () => {
  const repository = new MemoryAuth();
  await repository.createUser({ email: "member@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "Member", active: true, lockedAt: null, sessionVersion: 0 });
  const app = buildApp({ isReady: () => true }, "silent");
  registerAuthRoutes(app, { repository, secret });
  const cookie = sessionCookie(signSession({ userId: "1", email: "member@example.test", role: "user", workspaceId: "workspace-a", sessionVersion: 0 }, secret));

  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode, 200);
  await repository.updateUser("1", { role: "admin", workspaceId: "workspace-b" });
  assert.equal((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode, 401);
  await app.close();
});

test("bootstrap is disabled without token and guarded when configured", async () => {
  const repository = new MemoryAuth(); const app = buildApp({ isReady: () => true }, "silent");
  registerAuthRoutes(app, { repository, secret });
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/bootstrap-users" })).statusCode, 503); await app.close();
  const enabled = buildApp({ isReady: () => true }, "silent"); registerAuthRoutes(enabled, { repository, secret, bootstrapToken: "bootstrap-secret", configuredUsers: [{ email: "user@example.test", password: "valid-pass", role: "user", workspaceId: "w1" }] });
  assert.equal((await enabled.inject({ method: "POST", url: "/api/auth/bootstrap-users", headers: { authorization: "Bearer wrong" } })).statusCode, 403);
  assert.equal((await enabled.inject({ method: "POST", url: "/api/auth/bootstrap-users", headers: { authorization: "Bearer bootstrap-secret" } })).statusCode, 200); await enabled.close();
});

test("forgot password sends the reset link through mail without exposing it in the generic response", async () => {
  const repository = new MemoryAuth();
  await repository.createUser({ email: "owner@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "Owner", active: true, lockedAt: null });
  const delivered: PasswordResetEmail[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const app = buildApp({ isReady: () => true }, "silent");
  registerAuthRoutes(app, {
    repository,
    secret,
    mail: { sendPasswordResetEmail: async (email) => { delivered.push(email); } },
    audit: async (_event, _request, _actor, _email, resource) => { if (resource) audits.push(resource); },
  });

  const response = await app.inject({ method: "POST", url: "/api/auth/forgot-password", headers: { "x-forwarded-host": "test.local", "x-forwarded-proto": "https" }, payload: { email: "owner@example.test" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().resetLink, undefined);
  assert.equal(delivered.length, 1);
  assert.match(delivered[0]!.resetLink, /^https:\/\/test\.local\/forgot-password\?token=/);
  assert.equal(audits.at(-1)?.delivered, true);

  const unknown = await app.inject({ method: "POST", url: "/api/auth/forgot-password", payload: { email: "unknown@example.test" } });
  assert.equal(unknown.statusCode, 200);
  assert.equal(delivered.length, 1);
  await app.close();
});

test("forgot password keeps the generic response and audits delivery failure", async () => {
  const repository = new MemoryAuth();
  await repository.createUser({ email: "owner@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "Owner", active: true, lockedAt: null });
  const audits: Array<Record<string, unknown>> = [];
  const app = buildApp({ isReady: () => true }, "silent");
  registerAuthRoutes(app, {
    repository,
    secret,
    returnResetToken: true,
    mail: { sendPasswordResetEmail: async () => { throw new Error("SMTP unavailable"); } },
    audit: async (_event, _request, _actor, _email, resource) => { if (resource) audits.push(resource); },
  });

  const response = await app.inject({ method: "POST", url: "/api/auth/forgot-password", headers: { "x-forwarded-host": "test.local", "x-forwarded-proto": "https" }, payload: { email: "owner@example.test" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, message: "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi." });
  assert.equal(audits.at(-1)?.delivered, false);
  await app.close();
});

test("signed sessions expire from issuedAt and reject future timestamps", () => {
  const secret = "01234567890123456789012345678901";
  const session = { userId: "u1", email: "u@example.test", role: "user", workspaceId: "w1" } as const;
  const expired = sessionCookie(signSession(session, secret, Date.now() - 3_601_000));
  const future = sessionCookie(signSession(session, secret, Date.now() + 6 * 60_000));
  const request = (cookie: string) => ({ headers: { cookie } } as never);
  assert.throws(() => sessionFromRequest(request(expired), secret, 3_600_000), (error) => (error as { code?: string }).code === "UNAUTHENTICATED");
  assert.throws(() => sessionFromRequest(request(future), secret, 3_600_000), (error) => (error as { code?: string }).code === "UNAUTHENTICATED");
});
