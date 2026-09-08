import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmail, requirePassword, validEmail } from "../src/services/auth-policy.js";

test("auth policy normalizes and validates the shared email rule", () => {
  assert.equal(normalizeEmail(" User@Example.test "), "user@example.test");
  assert.equal(normalizeEmail(undefined), "");
  assert.equal(validEmail("user@example.test"), true);
  assert.equal(validEmail("invalid"), false);
});

test("auth policy keeps the shared password error contract", () => {
  assert.equal(requirePassword("valid-pass"), "valid-pass");
  assert.throws(() => requirePassword("short"), (error) => {
    const value = error as { code?: string; statusCode?: number; fields?: { password?: string } };
    return value.code === "INVALID_PASSWORD" && value.statusCode === 400 && value.fields?.password === "Mật khẩu phải có ít nhất 8 ký tự.";
  });
});
