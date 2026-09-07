import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import { InMemoryMasterdataRepository } from "../src/masterdata.js";
import { registerMasterdataRoutes } from "../src/masterdata-routes.js";
import type { AuthRepository } from "../src/auth-repository.js";
const secret = "01234567890123456789012345678901";
const cookie = (role: "user" | "admin") => sessionCookie(signSession({ userId: role === "admin" ? "admin" : "u", email: `${role}@example.test`, role, workspaceId: "w" }, secret));
const users = { findUserById: async (id: string) => id === "admin" ? { id, email: "admin@example.test", passwordHash: "", role: "admin" as const, workspaceId: "w", displayName: "Admin", active: true, lockedAt: null } : id === "u" ? { id, email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "w", displayName: "User", active: true, lockedAt: null } : null } as unknown as Pick<AuthRepository, "findUserById">;
test("masterdata reads require auth and writes require revalidated admin with duplicate checks", async () => { const repo = new InMemoryMasterdataRepository(); const app = buildApp({ isReady: () => true }, "silent"); registerMasterdataRoutes(app, repo, secret, users); assert.equal((await app.inject({ url: "/api/banks" })).statusCode, 401); assert.equal((await app.inject({ method: "POST", url: "/api/banks", headers: { cookie: cookie("user") }, payload: { shortname: "TST" } })).statusCode, 403); assert.equal((await app.inject({ method: "POST", url: "/api/banks", headers: { cookie: cookie("admin") }, payload: { shortname: "TST", name: "Test", fullname: "Test Bank", logo: "logo" } })).statusCode, 201); assert.equal((await app.inject({ method: "POST", url: "/api/banks", headers: { cookie: cookie("admin") }, payload: { shortname: "tst" } })).statusCode, 400); assert.equal((await app.inject({ url: "/api/banks", headers: { cookie: cookie("user") } })).json().length, 1); assert.equal((await app.inject({ method: "POST", url: "/api/cardtypes", headers: { cookie: cookie("admin") }, payload: { name: "Visa", logo: "logo" } })).statusCode, 201); await app.close(); });

test("masterdata rejects a stale admin session before repository mutation", async (t) => { const repo = new InMemoryMasterdataRepository(); const create = t.mock.method(repo, "create"); const demotedUsers = { findUserById: async () => ({ id: "admin", email: "admin@example.test", passwordHash: "", role: "user" as const, workspaceId: "w", displayName: "Demoted", active: true, lockedAt: null }) } as unknown as Pick<AuthRepository, "findUserById">; const app = buildApp({ isReady: () => true }, "silent"); registerMasterdataRoutes(app, repo, secret, demotedUsers); const response = await app.inject({ method: "POST", url: "/api/banks", headers: { cookie: cookie("admin") }, payload: { shortname: "TST" } }); assert.equal(response.statusCode, 403); assert.equal(create.mock.callCount(), 0); await app.close(); });

test("masterdata GET returns normalized safe DTOs and strips persistence fields", async () => {
  const repo = new InMemoryMasterdataRepository();
  repo.values.banks = [{ _id: "bank-1", shortname: "TST", name: "Test", fullname: "Test Bank", logo: "logo", createdAt: new Date(), tokenHash: "secret" }];
  repo.values.cardtypes = [{ _id: "type-1", name: "Visa", logo: "logo", updatedAt: new Date(), passwordHash: "secret" }];
  const app = buildApp({ isReady: () => true }, "silent");
  registerMasterdataRoutes(app, repo, secret, users);
  const banks = await app.inject({ url: "/api/banks", headers: { cookie: cookie("user") } });
  const cardTypes = await app.inject({ url: "/api/cardtypes", headers: { cookie: cookie("user") } });
  assert.deepEqual(banks.json(), [{ _id: "bank-1", shortname: "TST", name: "Test", fullname: "Test Bank", logo: "logo" }]);
  assert.deepEqual(cardTypes.json(), [{ _id: "type-1", name: "Visa", logo: "logo" }]);
  repo.values.banks.push({ _id: "bank-2", shortname: "AAA", name: "Another", fullname: "Another Bank", logo: "logo" });
  assert.deepEqual((await app.inject({ url: "/api/banks?limit=1", headers: { cookie: cookie("user") } })).json().map((bank: { shortname: string }) => bank.shortname), ["AAA"]);
  await app.close();
});
