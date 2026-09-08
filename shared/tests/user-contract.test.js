import assert from "node:assert/strict";
import test from "node:test";
import { userListSchema, userSchema } from "../src/index.js";

const user = { id: "user-1", email: "user@example.test", role: "user", workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };

test("user read schema preserves safe identity fields and rejects secrets", () => {
  assert.deepEqual(userSchema.parse(user), user);
  assert.deepEqual(userListSchema.parse([user]), [user]);
  assert.throws(() => userSchema.parse({ ...user, passwordHash: "secret" }));
  assert.throws(() => userSchema.parse({ ...user, lockedAt: "2026-08-16" }));
  assert.throws(() => userSchema.parse({ ...user, id: "" }));
});
