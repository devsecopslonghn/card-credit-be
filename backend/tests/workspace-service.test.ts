import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceService, type WorkspaceRepository } from "../src/services/workspace-service.js";
import type { AuthUser } from "../src/auth-repository.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { userId: "admin-1", workspaceId: "workspace-a", role: "admin", channel: "browser", correlationId: "workspace-test" };
const owner: AuthUser = { id: "owner-1", email: "owner@example.test", passwordHash: "", role: "user", workspaceId: "workspace-a", displayName: "Owner", active: true, lockedAt: null };

test("workspace service scopes owner status and mutation to the trusted workspace", async () => {
  const calls: Array<{ filter: Record<string, unknown>; update?: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  const workspaces: WorkspaceRepository = {
    findOne: async (filter) => { calls.push({ filter }); return { ownerUserId: "owner-1" }; },
    updateOne: async (filter, update, options) => { calls.push({ filter, update, options }); return {}; },
  };
  const users = { findUserById: async (id: string) => id === owner.id ? owner : null };

  assert.deepEqual(await WorkspaceService.ownerStatus({ ...context, workspaceId: "workspace-a" }, workspaces), { configured: true });
  assert.deepEqual(await WorkspaceService.setOwner(context, owner.id, users, workspaces), { configured: true });
  assert.deepEqual(calls[0], { filter: { workspaceId: "workspace-a" } });
  assert.deepEqual(calls[1]?.filter, { workspaceId: "workspace-a" });
  assert.deepEqual(calls[1]?.options, { upsert: true });
  assert.equal((calls[1]?.update?.$set as { ownerUserId: string }).ownerUserId, owner.id);
});

test("workspace service rejects non-admin or cross-workspace owners before persistence", async () => {
  let writes = 0;
  const workspaces: WorkspaceRepository = {
    findOne: async () => null,
    updateOne: async () => { writes += 1; return {}; },
  };
  const users = { findUserById: async () => ({ ...owner, workspaceId: "workspace-other" }) };
  await assert.rejects(() => WorkspaceService.setOwner({ ...context, role: "user" }, owner.id, users, workspaces), { code: "FORBIDDEN" });
  await assert.rejects(() => WorkspaceService.setOwner(context, owner.id, users, workspaces), { code: "INVALID_WORKSPACE_OWNER" });
  assert.equal(writes, 0);
});
