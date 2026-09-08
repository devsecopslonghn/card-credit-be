import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import type { AuthRepository } from "../src/auth-repository.js";
import { registerRecurringExpenseRoutes } from "../src/recurring-expense-routes.js";
import { RecurringExpenseService } from "../src/services/recurring-expense-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const cookie = sessionCookie(signSession({ userId: "user-1", email: "user@example.test", role: "user", workspaceId: "workspace-a" }, secret));
const activeUser = { findUserById: async () => ({ id: "user-1", email: "user@example.test", passwordHash: "", displayName: "User", role: "user" as const, workspaceId: "workspace-a", active: true, lockedAt: null }) } as unknown as AuthRepository;
const item = { id: "recurring-1", name: "Internet", categoryId: "HOME", accountId: "507f1f77bcf86cd799439011", expectedAmount: 250_000, frequency: "MONTHLY" as const, nextDueDate: "2026-09-05", active: true };

test("recurring REST lifecycle uses trusted context and canonical envelopes", async (t) => {
  const payload = { name: item.name, categoryId: item.categoryId, accountId: item.accountId, expectedAmount: item.expectedAmount, frequency: item.frequency, nextDueDate: item.nextDueDate };
  const list = t.mock.method(RecurringExpenseService, "list", async (context: ServiceContext, limit: number) => {
    assert.equal(context.userId, "user-1");
    assert.equal(context.workspaceId, "workspace-a");
    assert.equal(context.channel, "browser");
    assert.equal(limit, 17);
    return [item];
  });
  const create = t.mock.method(RecurringExpenseService, "create", async (context: ServiceContext, received: unknown) => {
    assert.equal(context.workspaceId, "workspace-a");
    assert.deepEqual(received, payload);
    return item;
  });
  const update = t.mock.method(RecurringExpenseService, "update", async (context: ServiceContext, id: string, received: unknown) => {
    assert.equal(context.workspaceId, "workspace-a");
    assert.equal(id, item.id);
    assert.deepEqual(received, payload);
    return item;
  });
  const deactivate = t.mock.method(RecurringExpenseService, "deactivate", async (context: ServiceContext, id: string) => {
    assert.equal(context.workspaceId, "workspace-a");
    assert.equal(id, item.id);
    return { ...item, active: false };
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerRecurringExpenseRoutes(app, secret, activeUser);

  assert.equal((await app.inject({ url: "/api/finance/recurring-expenses?limit=17", headers: { cookie } })).statusCode, 200);
  const created = await app.inject({ method: "POST", url: "/api/finance/recurring-expenses", headers: { cookie }, payload });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().data, item);
  const edited = await app.inject({ method: "PUT", url: `/api/finance/recurring-expenses/${item.id}`, headers: { cookie }, payload });
  assert.equal(edited.statusCode, 200);
  const removed = await app.inject({ method: "DELETE", url: `/api/finance/recurring-expenses/${item.id}`, headers: { cookie } });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(removed.json().data, { ...item, active: false });
  assert.equal(list.mock.callCount(), 1);
  assert.equal(create.mock.callCount(), 1);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(deactivate.mock.callCount(), 1);
  await app.close();
});

test("recurring REST lifecycle requires a session", async () => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerRecurringExpenseRoutes(app, secret, activeUser);
  assert.equal((await app.inject({ url: "/api/finance/recurring-expenses" })).statusCode, 401);
  await app.close();
});
