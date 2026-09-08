import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import type { AuthRepository } from "../src/auth-repository.js";
import { registerFinanceRoutes } from "../src/finance-routes.js";
import { FinanceCategoryService } from "../src/services/finance-category-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const user = { id: "user-1", email: "user@example.test", passwordHash: "", displayName: "User", role: "user" as const, workspaceId: "workspace-a", active: true, lockedAt: null };
const users = { findUserById: async () => user } as unknown as AuthRepository;
const cookie = sessionCookie(signSession({ userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId }, secret));
const category = { id: "category-1", name: "FOOD", parentId: null, system: false };

test("finance category REST uses canonical list/create services and trusted context", async (t) => {
  const list = t.mock.method(FinanceCategoryService, "list", async (context: ServiceContext, limit: unknown) => {
    assert.equal(context.userId, user.id);
    assert.equal(context.workspaceId, user.workspaceId);
    assert.equal(context.channel, "browser");
    assert.equal(limit, "17");
    return [category];
  });
  const create = t.mock.method(FinanceCategoryService, "create", async (context: ServiceContext, input: { name: string; parentId?: string }) => {
    assert.equal(context.workspaceId, user.workspaceId);
    assert.deepEqual(input, { name: "Food", parentId: "parent-1" });
    return category;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinanceRoutes(app, secret, users);

  const listed = await app.inject({ url: "/api/finance/categories?limit=17", headers: { cookie } });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().data, [category]);
  const created = await app.inject({ method: "POST", url: "/api/finance/categories", headers: { cookie }, payload: { name: "Food", parentId: "parent-1" } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().data, category);
  assert.equal(list.mock.callCount(), 1);
  assert.equal(create.mock.callCount(), 1);
  await app.close();
});

test("finance category routes require a session", async () => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinanceRoutes(app, secret, users);
  assert.equal((await app.inject({ url: "/api/finance/categories" })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/finance/categories", payload: { name: "Food" } })).statusCode, 401);
  await app.close();
});

test("finance category create rejects tenant fields before service access", async (t) => {
  const create = t.mock.method(FinanceCategoryService, "create");
  const app = buildApp({ isReady: () => true }, "silent");
  registerFinanceRoutes(app, secret, users);
  const response = await app.inject({ method: "POST", url: "/api/finance/categories", headers: { cookie }, payload: { name: "Food", workspaceId: "attacker" } });
  assert.equal(response.statusCode, 400);
  assert.equal(create.mock.callCount(), 0);
  await app.close();
});
