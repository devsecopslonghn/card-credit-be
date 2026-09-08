import assert from "node:assert/strict";
import test from "node:test";
import { authSessionListSchema, authSessionSchema } from "../src/index.js";

const session = { email: "user@example.test", role: "user", workspaceId: "workspace-a" };

test("auth session contract is minimal, strict and shared", () => {
  assert.deepEqual(authSessionSchema.parse(session), session);
  assert.deepEqual(authSessionListSchema.parse([session]), [session]);
  assert.throws(() => authSessionSchema.parse({ ...session, userId: "secret" }));
  assert.throws(() => authSessionSchema.parse({ ...session, passwordHash: "secret" }));
  assert.throws(() => authSessionSchema.parse({ ...session, role: "owner" }));
});
