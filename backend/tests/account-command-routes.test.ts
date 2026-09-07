import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import { registerAccountRoutes } from "../src/account-routes.js";
import { AccountService } from "../src/services/account-service.js";
import type { AuthRepository } from "../src/auth-repository.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const user = { id: "user-a", email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };
const users = { findUserById: async (id: string) => id === user.id ? user : null } as unknown as AuthRepository;
const cookie = sessionCookie(signSession({ userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId }, secret));

test("REST account command requires and forwards the idempotency boundary", async (t) => {
  const create = t.mock.method(AccountService, "create", async (_context: ServiceContext, _input: Record<string, unknown>, invocation: { idempotencyKey: string; endpointOrTool: string }) => {
    assert.deepEqual(invocation, { idempotencyKey: "account-command-1", endpointOrTool: "POST /api/accounts" });
    return { id: "account-1" } as never;
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerAccountRoutes(app, secret, users);
  const body = { name: "Cash", type: "CASH", openingBalance: 0 };
  const missing = await app.inject({ method: "POST", url: "/api/accounts", headers: { cookie }, payload: body });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const short = await app.inject({ method: "POST", url: "/api/accounts", headers: { cookie, "idempotency-key": "short" }, payload: body });
  assert.equal(short.statusCode, 400);
  assert.equal(short.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const response = await app.inject({ method: "POST", url: "/api/accounts", headers: { cookie, "idempotency-key": " account-command-1 " }, payload: body });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json().data, { id: "account-1" });
  assert.equal(create.mock.callCount(), 1);
  await app.close();
});
