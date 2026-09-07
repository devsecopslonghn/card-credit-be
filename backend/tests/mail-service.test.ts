import assert from "node:assert/strict";
import test from "node:test";
import { MailUnavailableError, maskEmail, parseSmtpConfig } from "../src/mail-service.js";

const base = { SMTP_HOST: "smtp-relay.brevo.com:587", SMTP_USER: "user", SMTP_PASSWORD: "super-secret", SMTP_FROM_ADDRESS: "Money <noreply@example.test>" };

test("SMTP parser supports temporary host:port and STARTTLS defaults", () => {
  assert.deepEqual(parseSmtpConfig(base), { host: "smtp-relay.brevo.com", port: 587, secure: false, user: "user", password: "super-secret", from: "Money <noreply@example.test>" });
});

test("SMTP parser gives separate port priority and applies secure rules", () => {
  assert.equal(parseSmtpConfig({ ...base, SMTP_PORT: "465" }).port, 465);
  assert.equal(parseSmtpConfig({ ...base, SMTP_PORT: "465" }).secure, true);
  assert.equal(parseSmtpConfig({ ...base, SMTP_PORT: "465", SMTP_SECURE: "false" }).secure, false);
  assert.equal(parseSmtpConfig({ ...base, SMTP_SECURE: "true" }).secure, true);
  assert.equal(parseSmtpConfig({ ...base, SMTP_HOST: "smtp.example.test", SMTP_PORT: "2525" }).port, 2525);
});

test("SMTP parser safely rejects malformed or missing values without echoing secrets", () => {
  for (const env of [
    { ...base, SMTP_PORT: "0" },
    { ...base, SMTP_PORT: "65536" },
    { ...base, SMTP_PORT: "abc" },
    { ...base, SMTP_HOST: "bad host:587" },
    { ...base, SMTP_SECURE: "yes" },
    { ...base, SMTP_FROM_ADDRESS: "bad-address" },
    { ...base, SMTP_USER: "" },
    { ...base, SMTP_PASSWORD: "" },
  ]) assert.throws(() => parseSmtpConfig(env), (error) => error instanceof MailUnavailableError && !error.message.includes("super-secret"));
});

test("recipient masking retains only the first local character", () => {
  assert.equal(maskEmail("long@example.test"), "l***@example.test");
});
