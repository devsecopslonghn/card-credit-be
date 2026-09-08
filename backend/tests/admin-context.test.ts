import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import type { AuthRepository, AuthUser } from "../src/auth-repository.js";
import { registerUserRoutes } from "../src/user-routes.js";
import { AdminAuditService } from "../src/services/admin-audit-service.js";
import { MongoAuthRepository } from "../src/auth-repository.js";

const secret = "01234567890123456789012345678901";
const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "admin-1", email: "admin@example.test", passwordHash: "", role: "admin", workspaceId: "workspace-a",
  displayName: "Admin", active: true, lockedAt: null, ...overrides,
});
const cookie = (user: AuthUser, role: "admin" | "user" = user.role) => sessionCookie(signSession({ userId: user.id, email: user.email, role, workspaceId: user.workspaceId }, secret));

test("admin user and audit routes use the revalidated admin context", async (t) => {
  const admin = makeUser();
  const target = makeUser({ id: "user-1", email: "user@example.test", role: "user", displayName: "Target", lockedAt: new Date("2026-08-16T00:00:00.000Z") });
  let listCalls = 0;
  const updates: Array<{ id: string; update: object }> = [];
  const users = {
    findUserById: async (id: string) => id === admin.id ? admin : id === target.id ? target : null,
    listUsers: async () => { listCalls += 1; return [admin, target]; },
    updateUser: async (id: string, update: object) => { updates.push({ id, update }); return id === target.id ? { ...target, ...update } : null; },
  } as unknown as AuthRepository;
  const collection = t.mock.method(mongoose.connection, "collection", () => ({
    find: (query: Record<string, unknown>) => {
      assert.deepEqual(query, { event: "LOGIN", userId: "user-1", email: "user@example.test", "resource.type": "session", "resource.id": "r1" });
      return {
        sort: (spec: Record<string, unknown>) => {
          assert.deepEqual(spec, { createdAt: -1, _id: -1 });
          return {
            limit: (limit: number) => {
              assert.equal(limit, 8);
              return { toArray: async () => [{ _id: "audit-1", event: "LOGIN" }] };
            },
          };
        },
      };
    },
  }) as never);
  const app = buildApp({ isReady: () => true }, "silent");
  registerUserRoutes(app, users, secret);

  const headers = { cookie: cookie(admin) };
  const list = await app.inject({ url: "/api/admin/users", headers });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().users.length, 2);
  assert.equal(list.json().users.find((user: { id: string }) => user.id === target.id).lockedAt, "2026-08-16T00:00:00.000Z");
  assert.equal(listCalls, 1);
  const updated = await app.inject({ method: "PATCH", url: "/api/admin/users/user-1", headers, payload: { displayName: "  New   Name ", role: "user", workspaceId: "  workspace-b " } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().user.displayName, "New Name");
  assert.deepEqual(updates, [{ id: "user-1", update: { displayName: "New Name", role: "user", workspaceId: "workspace-b" } }]);
  const logs = await app.inject({ url: "/api/admin/audit-logs?event=LOGIN&userId=user-1&email=User%40Example.Test&resourceType=session&resourceId=r1&limit=7", headers });
  assert.equal(logs.statusCode, 200);
  assert.deepEqual(logs.json(), { logs: [{ id: "audit-1", event: "LOGIN" }], filters: { event: "LOGIN", userId: "user-1", email: "user@example.test", "resource.type": "session", "resource.id": "r1" }, limit: 7, nextCursor: null });
  assert.equal(collection.mock.callCount(), 1);
  await app.close();
});

test("admin audit cursor returns a stable continuation without dropping records", async () => {
  const first = { _id: "audit-1", createdAt: new Date("2026-08-17T10:00:00.000Z"), event: "LOGIN" };
  const second = { _id: "audit-2", createdAt: new Date("2026-08-17T09:00:00.000Z"), event: "LOGOUT" };
  let receivedQuery: Record<string, unknown> | undefined;
  let call = 0;
  const repository = {
    list: async (query: Record<string, unknown>, limit: number) => {
      receivedQuery = query;
      assert.equal(limit, 2);
      call += 1;
      return call === 1 ? [first, second] : [second];
    },
  };
  const page = await AdminAuditService.list({ limit: "1" }, repository);
  assert.equal(page.logs.length, 1);
  assert.equal(typeof page.nextCursor, "string");
  assert.deepEqual((page.nextCursor ? await AdminAuditService.list({ limit: "1", cursor: page.nextCursor }, repository) : null)?.logs, [{ id: "audit-2", createdAt: second.createdAt, event: "LOGOUT" }]);
  assert.equal(Array.isArray(receivedQuery?.$or), true);
  await assert.rejects(() => AdminAuditService.list({ cursor: "invalid" }, repository), (error: unknown) => (error as { code?: string }).code === "INVALID_AUDIT_CURSOR");
});

test("admin user repository exposes a stable bounded cursor page", async (t) => {
  const rows = [
    { _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"), email: "a@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "A", active: true, lockedAt: null },
    { _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439012"), email: "b@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "B", active: true, lockedAt: null },
  ];
  const find = t.mock.method(mongoose.connection, "collection", () => ({
    find: (query: Record<string, unknown>) => {
      assert.deepEqual(query, {});
      return { sort: (spec: Record<string, unknown>) => { assert.deepEqual(spec, { email: 1, _id: 1 }); return { limit: (limit: number) => { assert.equal(limit, 2); return { toArray: async () => rows }; } }; } };
    },
  }) as never);
  const page = await new MongoAuthRepository().listUsersPage({ limit: "1" });
  assert.deepEqual(page.users.map((user) => user.email), ["a@example.test"]);
  assert.equal(typeof page.nextCursor, "string");
  assert.equal(page.limit, 1);
  assert.equal(find.mock.callCount(), 1);
});

test("admin routes reject non-admin and stale admin sessions before downstream work", async () => {
  const admin = makeUser();
  const user = makeUser({ id: "user-1", email: "user@example.test", role: "user" });
  let listCalls = 0;
  let updateCalls = 0;
  const users = {
    findUserById: async (id: string) => id === admin.id ? admin : id === user.id ? user : null,
    listUsers: async () => { listCalls += 1; return []; },
    updateUser: async () => { updateCalls += 1; return null; },
  } as unknown as AuthRepository;
  const app = buildApp({ isReady: () => true }, "silent");
  registerUserRoutes(app, users, secret);
  assert.equal((await app.inject({ url: "/api/admin/users", headers: { cookie: cookie(user, "user") } })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/admin/users/user-1", headers: { cookie: cookie(user, "user") }, payload: { displayName: "Nope" } })).statusCode, 403);
  admin.role = "user";
  const demotedCookie = cookie(admin, "admin");
  assert.equal((await app.inject({ url: "/api/admin/users", headers: { cookie: demotedCookie } })).statusCode, 403);
  admin.role = "admin";
  admin.active = false;
  assert.equal((await app.inject({ url: "/api/admin/audit-logs", headers: { cookie: cookie(admin) } })).statusCode, 401);
  admin.active = true;
  admin.lockedAt = new Date();
  assert.equal((await app.inject({ url: "/api/admin/users", headers: { cookie: cookie(admin) } })).statusCode, 401);
  admin.lockedAt = null;
  admin.workspaceId = "workspace-b";
  assert.equal((await app.inject({ url: "/api/admin/users", headers: { cookie: cookie({ ...admin, workspaceId: "workspace-a" }) } })).statusCode, 401);
  assert.equal(listCalls, 0);
  assert.equal(updateCalls, 0);
  await app.close();
});
