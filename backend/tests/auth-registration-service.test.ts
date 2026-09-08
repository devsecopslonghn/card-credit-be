import assert from "node:assert/strict";
import test from "node:test";
import { AuthRegistrationService } from "../src/services/auth-registration-service.js";
import type { AuthUser } from "../src/auth-repository.js";

const existing: AuthUser = {
  id: "user-1", email: "existing@example.test", passwordHash: "unused", role: "user",
  workspaceId: "workspace-a", displayName: "Existing", active: true, lockedAt: null,
};

test("auth registration service creates the first user as admin in a derived workspace", async () => {
  let created: Omit<AuthUser, "id"> | undefined;
  const result = await AuthRegistrationService.register("owner@example.test", "valid-pass", "  Owner  ", {
    findUserByEmail: async () => null,
    countUsers: async () => 0,
    createUser: async (input) => { created = input; return { ...input, id: "owner-1" }; },
  });
  assert.equal(result.role, "admin");
  assert.match(result.workspaceId, /^personal-[a-f0-9]{24}$/);
  assert.equal(created?.displayName, "Owner");
  assert.match(created?.passwordHash ?? "", /^scrypt\$/);
});

test("auth registration service keeps duplicate and validation failures before creation", async () => {
  let creates = 0;
  const repository = {
    findUserByEmail: async () => existing,
    countUsers: async () => 1,
    createUser: async (input: Omit<AuthUser, "id">) => { creates += 1; return { ...input, id: "new" }; },
  };
  await assert.rejects(() => AuthRegistrationService.register("existing@example.test", "valid-pass", undefined, repository), (error) => (error as { code?: string }).code === "EMAIL_ALREADY_REGISTERED");
  await assert.rejects(() => AuthRegistrationService.register("invalid", "valid-pass", undefined, { ...repository, findUserByEmail: async () => null }), (error) => (error as { code?: string }).code === "INVALID_EMAIL");
  await assert.rejects(() => AuthRegistrationService.register("new@example.test", "short", undefined, { ...repository, findUserByEmail: async () => null }), (error) => (error as { code?: string }).code === "INVALID_PASSWORD");
  assert.equal(creates, 0);
});
