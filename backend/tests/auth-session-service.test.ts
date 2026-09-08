import assert from "node:assert/strict";
import test from "node:test";
import { AuthSessionService } from "../src/services/auth-session-service.js";
import { hashPassword } from "../src/password.js";
import type { AuthUser } from "../src/auth-repository.js";

const user: AuthUser = {
  id: "user-1", email: "user@example.test", passwordHash: "", role: "user",
  workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null, sessionVersion: 3,
};

test("auth session service verifies credentials, touches login once and returns trusted session", async () => {
  const passwordHash = await hashPassword("valid-pass");
  let lookedUp = "";
  let touches = 0;
  const result = await AuthSessionService.login("user@example.test", "valid-pass", {
    findUserByEmail: async (email) => { lookedUp = email; return { ...user, passwordHash }; },
    touchLogin: async (id) => { assert.equal(id, user.id); touches += 1; },
  });
  assert.equal(lookedUp, user.email);
  assert.equal(touches, 1);
  assert.deepEqual(result, { userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId, sessionVersion: 3 });
});

test("auth session service rejects inactive, locked or invalid credentials before touchLogin", async () => {
  const passwordHash = await hashPassword("valid-pass");
  let touches = 0;
  const repository = {
    findUserByEmail: async () => ({ ...user, passwordHash }),
    touchLogin: async () => { touches += 1; },
  };
  await assert.rejects(() => AuthSessionService.login(user.email, "wrong-pass", repository), (error) => (error as { code?: string }).code === "UNAUTHENTICATED");
  await assert.rejects(() => AuthSessionService.login(user.email, "valid-pass", { ...repository, findUserByEmail: async () => ({ ...user, passwordHash, active: false }) }), (error) => (error as { code?: string }).code === "UNAUTHENTICATED");
  await assert.rejects(() => AuthSessionService.login(user.email, "valid-pass", { ...repository, findUserByEmail: async () => ({ ...user, passwordHash, lockedAt: new Date() }) }), (error) => (error as { code?: string }).code === "UNAUTHENTICATED");
  assert.equal(touches, 0);
});
