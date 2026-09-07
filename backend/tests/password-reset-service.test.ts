import assert from "node:assert/strict";
import test from "node:test";
import type { AuthUser, ResetToken } from "../src/auth-repository.js";
import { ForgotPasswordService, hashResetToken, PasswordResetService } from "../src/services/password-reset-service.js";

const user: AuthUser = {
  id: "user-1", email: "user@example.test", passwordHash: "old", role: "user",
  workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null,
};

test("forgot password service creates a hashed token and reports mail delivery", async () => {
  let created: ResetToken | undefined;
  let delivered: { to: string; resetLink: string; expiresAt: Date } | undefined;
  const result = await ForgotPasswordService.request(" USER@Example.test ", {
    repository: {
      findUserByEmail: async (email) => email === user.email ? user : null,
      createResetToken: async (token) => { created = token; },
    },
    resetBaseUrl: "https://test.local",
    returnResetToken: true,
    mail: { sendPasswordResetEmail: async (email) => { delivered = email; } },
  });
  assert.equal(result.email, user.email);
  assert.match(result.resetLink ?? "", /^https:\/\/test\.local\/forgot-password\?token=[A-Za-z0-9_-]+$/);
  assert.ok(created);
  assert.match(created.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(created.userId, user.id);
  assert.equal(delivered?.to, user.email);
  assert.equal(delivered?.resetLink, result.resetLink);
  assert.ok((created.expiresAt.getTime() - Date.now()) > 29 * 60 * 1000);
});

test("forgot password service keeps generic response and avoids token writes for unknown or locked users", async () => {
  let writes = 0;
  const result = await ForgotPasswordService.request("unknown@example.test", {
    repository: { findUserByEmail: async () => null, createResetToken: async () => { writes += 1; } },
    resetBaseUrl: "https://test.local",
  });
  assert.equal(result.resetLink, null);
  await ForgotPasswordService.request(user.email, {
    repository: { findUserByEmail: async () => ({ ...user, lockedAt: new Date() }), createResetToken: async () => { writes += 1; } },
    resetBaseUrl: "https://test.local",
  });
  assert.equal(writes, 0);
  await assert.rejects(() => ForgotPasswordService.request("invalid", { repository: { findUserByEmail: async () => null, createResetToken: async () => { writes += 1; } }, resetBaseUrl: "https://test.local" }), (error) => (error as { code?: string }).code === "INVALID_EMAIL");
  assert.equal(writes, 0);
});

test("password reset service validates token, updates password and consumes tokens", async () => {
  const rawToken = "reset-token";
  const token: ResetToken = { tokenHash: hashResetToken(rawToken), userId: user.id, email: user.email, expiresAt: new Date(Date.now() + 60_000), usedAt: null };
  let lookupHash = "";
  let updated: { id: string; hash: string } | undefined;
  let consumed = "";
  const result = await PasswordResetService.complete(rawToken, "new-valid-pass", {
    findResetToken: async (hash) => { lookupHash = hash; return token; },
    findUserById: async () => user,
    updatePassword: async (id, hash) => { updated = { id, hash }; },
    consumeResetTokens: async (id) => { consumed = id; },
  });
  assert.equal(result, user);
  assert.equal(lookupHash, token.tokenHash);
  assert.equal(updated?.id, user.id);
  assert.match(updated?.hash ?? "", /^scrypt\$/);
  assert.equal(consumed, user.id);
});

test("password reset service fails closed before writes for invalid password/token or user", async () => {
  let writes = 0;
  const repository = {
    findResetToken: async () => null,
    findUserById: async () => user,
    updatePassword: async () => { writes += 1; },
    consumeResetTokens: async () => { writes += 1; },
  };
  await assert.rejects(() => PasswordResetService.complete("token", "short", repository), (error) => (error as { code?: string }).code === "INVALID_PASSWORD");
  await assert.rejects(() => PasswordResetService.complete("", "valid-pass", repository), (error) => (error as { code?: string }).code === "INVALID_TOKEN");
  await assert.rejects(() => PasswordResetService.complete("token", "valid-pass", repository), (error) => (error as { code?: string }).code === "INVALID_TOKEN");
  const validToken = { tokenHash: hashResetToken("token"), userId: user.id, email: user.email, expiresAt: new Date(Date.now() + 60_000), usedAt: null };
  await assert.rejects(() => PasswordResetService.complete("token", "valid-pass", { ...repository, findResetToken: async () => validToken, findUserById: async () => ({ ...user, active: false }) }), (error) => (error as { code?: string }).code === "INVALID_TOKEN");
  assert.equal(writes, 0);
});
