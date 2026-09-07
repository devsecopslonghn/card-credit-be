import assert from "node:assert/strict";
import test from "node:test";
import { ProfileService } from "../src/services/profile-service.js";
import type { AuthUser } from "../src/auth-repository.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = {
  userId: "user-1", workspaceId: "workspace-a", role: "user", channel: "browser", correlationId: "request-1",
};
const user: AuthUser = {
  id: "user-1", email: "user@example.test", passwordHash: "unused", role: "user",
  workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null,
};

test("profile service reads the trusted user and fails closed when missing", async () => {
  assert.equal((await ProfileService.get(context, { findUserById: async () => user })).id, user.id);
  await assert.rejects(() => ProfileService.get(context, { findUserById: async () => null }), (error) => (error as { code?: string }).code === "USER_NOT_FOUND");
});

test("profile service normalizes display name before update delegation", async () => {
  let received: { id: string; update: { displayName?: string } } | undefined;
  const result = await ProfileService.update(context, { displayName: "  New   Name " }, {
    updateUser: async (id, update) => { received = { id, update }; return { ...user, ...update }; },
  });
  assert.deepEqual(received, { id: user.id, update: { displayName: "New Name" } });
  assert.equal(result.displayName, "New Name");
});

test("profile service rejects protected fields before repository update", async () => {
  let updateCalls = 0;
  await assert.rejects(() => ProfileService.update(context, { role: "admin" }, { updateUser: async () => { updateCalls += 1; return user; } }), (error) => (error as { code?: string }).code === "FORBIDDEN_PROFILE_FIELD");
  assert.equal(updateCalls, 0);
});

test("profile service rejects invalid or empty updates before repository access", async () => {
  let updateCalls = 0;
  const repository = { updateUser: async () => { updateCalls += 1; return user; } };

  await assert.rejects(() => ProfileService.update(context, {}, repository), (error) => (error as { code?: string }).code === "INVALID_REQUEST");
  await assert.rejects(() => ProfileService.update(context, { displayName: 42 }, repository), (error) => (error as { code?: string }).code === "INVALID_DISPLAY_NAME");
  await assert.rejects(() => ProfileService.update(context, { displayName: "x".repeat(81) }, repository), (error) => (error as { code?: string }).code === "INVALID_DISPLAY_NAME");
  assert.equal(updateCalls, 0);
});

test("profile service maps a missing update target to USER_NOT_FOUND", async () => {
  await assert.rejects(() => ProfileService.update(context, { displayName: "Updated" }, { updateUser: async () => null }), (error) => (error as { code?: string }).code === "USER_NOT_FOUND");
});
