import assert from "node:assert/strict";
import test from "node:test";
import type { AuthUser } from "../src/auth-repository.js";
import { AuthBootstrapService } from "../src/services/auth-bootstrap-service.js";

const user: AuthUser = { id: "user-1", email: "user@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };

test("auth bootstrap service normalizes configured users and delegates upsert", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const result = await AuthBootstrapService.run([{ email: " USER@Example.test ", passwordHash: "scrypt$fixture", role: "admin", workspaceId: "workspace-a", displayName: "  User  " }], {
    upsertUser: async (input) => { writes.push(input); return { ...user, ...input, email: input.email }; },
  });
  assert.equal(result[0]?.email, user.email);
  assert.equal(result[0]?.role, "admin");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { email: user.email, passwordHash: "scrypt$fixture", role: "admin", workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null });
});

test("auth bootstrap service hashes configured passwords and fails validation before persistence", async () => {
  let writes = 0;
  const repository = { upsertUser: async (input: Omit<AuthUser, "id">) => { writes += 1; return { ...user, ...input }; } };
  const result = await AuthBootstrapService.run([{ email: "user@example.test", password: "valid-pass", workspaceId: "workspace-a" }], repository);
  assert.match(result[0]?.passwordHash ?? "", /^scrypt\$/);
  await assert.rejects(() => AuthBootstrapService.run([{ email: "invalid", password: "valid-pass", workspaceId: "workspace-a" }], repository), (error) => (error as { code?: string }).code === "INVALID_EMAIL");
  await assert.rejects(() => AuthBootstrapService.run([{ email: "user@example.test", password: "short", workspaceId: "workspace-a" }], repository), (error) => (error as { code?: string }).code === "INVALID_PASSWORD");
  assert.equal(writes, 1);
});
