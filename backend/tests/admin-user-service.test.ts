import assert from "node:assert/strict";
import test from "node:test";
import { AdminUserService } from "../src/services/admin-user-service.js";
import type { AuthUser } from "../src/auth-repository.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context = (role: "admin" | "user"): ServiceContext => ({
  userId: "admin-1", workspaceId: "workspace-a", role, channel: "browser", correlationId: "request-1",
});
const user: AuthUser = {
  id: "user-1", email: "user@example.test", passwordHash: "unused", role: "user",
  workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null,
};

test("admin user service rejects non-admin before repository access", async () => {
  let listCalls = 0;
  let updateCalls = 0;
  const repository = {
    listUsers: async () => { listCalls += 1; return [user]; },
    updateUser: async () => { updateCalls += 1; return user; },
  };

  await assert.rejects(() => AdminUserService.list(context("user"), repository), (error) => (error as { code?: string }).code === "FORBIDDEN");
  await assert.rejects(() => AdminUserService.update(context("user"), user.id, { displayName: "Nope" }, repository), (error) => (error as { code?: string }).code === "FORBIDDEN");
  assert.equal(listCalls, 0);
  assert.equal(updateCalls, 0);
});

test("admin user service normalizes the supported update fields before delegation", async () => {
  let received: { id: string; update: Partial<Pick<AuthUser, "displayName" | "role" | "workspaceId">> } | undefined;
  const repository = {
    updateUser: async (id: string, update: Partial<Pick<AuthUser, "displayName" | "role" | "workspaceId">>) => {
      received = { id, update };
      return { ...user, ...update };
    },
  };

  const result = await AdminUserService.update(context("admin"), user.id, { displayName: "  New   Name ", role: "admin", workspaceId: "  workspace-b " }, repository);
  assert.deepEqual(received, { id: user.id, update: { displayName: "New Name", role: "admin", workspaceId: "workspace-b" } });
  assert.equal(result?.displayName, "New Name");
});

test("admin user service rejects unsupported update fields without repository access", async () => {
  let updateCalls = 0;
  const repository = { updateUser: async () => { updateCalls += 1; return user; } };
  await assert.rejects(() => AdminUserService.update(context("admin"), user.id, { active: false }, repository), (error) => (error as { code?: string }).code === "FORBIDDEN_UPDATE_FIELD");
  assert.equal(updateCalls, 0);
});
