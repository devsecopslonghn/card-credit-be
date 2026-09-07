import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import { registerUserRoutes } from "../src/user-routes.js";
import { registerWorkspaceRoutes } from "../src/workspace-routes.js";
import { WorkspaceModel } from "../src/models/workspace.js";
import type { AuthRepository, AuthUser } from "../src/auth-repository.js";

const secret = "01234567890123456789012345678901";
const user: AuthUser = { id: "u1", email: "u@example.test", passwordHash: "", role: "user", workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };
let profileUpdates = 0;
const users = { findUserById: async (id: string) => id === user.id ? user : null, updateUser: async (_id: string, update: { displayName?: string }) => { profileUpdates += 1; return { ...user, ...update }; } } as unknown as AuthRepository;
const cookie = (role: "user" | "admin" = "user", userId = user.id) => sessionCookie(signSession({ userId, email: user.email, role, workspaceId: "workspace-a" }, secret));

test("private profile and workspace reads revalidate active identity before downstream reads", async (t) => {
  const workspaceFind = t.mock.method(WorkspaceModel, "findOne", async (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a" });
    return { get: (key: string) => key === "ownerUserId" ? "owner-1" : undefined } as never;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerUserRoutes(app, users, secret);
  registerWorkspaceRoutes(app, users, secret);

  const headers = { cookie: cookie() };
  const profile = await app.inject({ url: "/api/profile", headers });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().user.id, "u1");
  const patched = await app.inject({ method: "PATCH", url: "/api/profile", headers, payload: { displayName: "  Updated User  " } });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().user.displayName, "Updated User");
  assert.equal(profileUpdates, 1);
  const owner = await app.inject({ url: "/api/workspace/owner", headers });
  assert.equal(owner.statusCode, 200);
  assert.deepEqual(owner.json(), { data: { configured: true } });
  assert.equal(workspaceFind.mock.callCount(), 1);

  user.workspaceId = "workspace-b";
  assert.equal((await app.inject({ url: "/api/profile", headers })).statusCode, 401);
  assert.equal((await app.inject({ method: "PATCH", url: "/api/profile", headers, payload: { displayName: "Should not write" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/workspace/owner", headers })).statusCode, 401);
  assert.equal(profileUpdates, 1);
  assert.equal(workspaceFind.mock.callCount(), 1);
  user.workspaceId = "workspace-a";
  await app.close();
});

test("workspace owner mutation revalidates admin role and target ownership", async (t) => {
  const admin: AuthUser = { id: "admin-1", email: "admin@example.test", passwordHash: "", role: "admin", workspaceId: "workspace-a", displayName: "Admin", active: true, lockedAt: null };
  const target: AuthUser = { id: "owner-1", email: "owner@example.test", passwordHash: "", role: "user", workspaceId: "workspace-a", displayName: "Owner", active: true, lockedAt: null };
  const update = t.mock.method(WorkspaceModel, "updateOne", async (filter: Record<string, unknown>, value: unknown, options: unknown) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a" });
    assert.deepEqual((value as { $set: object }).$set, { ownerUserId: "owner-1", updatedAt: (value as { $set: { updatedAt: Date } }).$set.updatedAt });
    assert.ok((value as { $set: { updatedAt: unknown } }).$set.updatedAt instanceof Date);
    assert.deepEqual((value as { $setOnInsert: object }).$setOnInsert, { createdAt: (value as { $setOnInsert: { createdAt: Date } }).$setOnInsert.createdAt });
    assert.ok((value as { $setOnInsert: { createdAt: unknown } }).$setOnInsert.createdAt instanceof Date);
    assert.deepEqual(options, { upsert: true });
    return { acknowledged: true, modifiedCount: 1 } as never;
  });
  const users = { findUserById: async (id: string) => id === admin.id ? admin : id === target.id ? target : null } as unknown as AuthRepository;
  const app = buildApp({ isReady: () => true }, "silent");
  registerWorkspaceRoutes(app, users, secret);
  const response = await app.inject({ method: "PUT", url: "/api/workspace/owner", headers: { cookie: cookie("admin", admin.id) }, payload: { ownerUserId: target.id } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { data: { configured: true } });
  assert.equal(update.mock.callCount(), 1);

  admin.role = "user" as never;
  const demoted = await app.inject({ method: "PUT", url: "/api/workspace/owner", headers: { cookie: cookie("admin", admin.id) }, payload: { ownerUserId: target.id } });
  assert.equal(demoted.statusCode, 403);
  assert.equal(update.mock.callCount(), 1);
  await app.close();
});
