import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import { InMemoryCatalogRepository, type CatalogProduct, validateCatalogProducts } from "../src/catalog.js";
import type { AuthRepository, AuthUser } from "../src/auth-repository.js";

const secret = "test-secret-at-least-thirty-two-characters";
const product: CatalogProduct = { presetId: "test-visa", providerCode: "TST", providerName: "Test Bank", displayName: "Test Visa", network: "Visa", segment: "Classic", annualFee: 100, targetSpendForWaiver: null, imageUrl: null, benefits: ["Benefit"], sourceUrl: "https://example.test/card", sourceCheckedAt: "2026-07-11", active: true, sortOrder: 1, theme: { background: "#000", accent: "#fff" } };
const cookie = (role = "admin", userId = "u1") => sessionCookie(signSession({ userId, email: userId === "u1" ? "admin@example.test" : "user@example.test", role, workspaceId: "w1" }, secret));
const adminUser: AuthUser = { id: "u1", email: "admin@example.test", passwordHash: "", role: "admin", workspaceId: "w1", displayName: "Admin", active: true, lockedAt: null };
const userUser: AuthUser = { id: "u2", email: "user@example.test", passwordHash: "", role: "user", workspaceId: "w1", displayName: "User", active: true, lockedAt: null };
const authUsers = { findUserById: async (id: string) => id === adminUser.id ? adminUser : id === userUser.id ? userUser : null } as unknown as Pick<AuthRepository, "findUserById">;

test("public catalog uses repository, hides inactive products, and omits legacy aliases", async () => {
  const app = buildApp({ isReady: () => true }, "silent", new InMemoryCatalogRepository([product, { ...product, presetId: "inactive-visa", sortOrder: 2, active: false }]), secret);
  const products = await app.inject({ url: "/api/card-catalog/products" }); assert.equal(products.statusCode, 200); assert.equal(products.json().data.length, 1); assert.equal(products.json().data[0].presetId, "test-visa"); assert.equal(products.json().data[0].id, undefined); assert.equal(products.json().data[0].bank, undefined);
  assert.equal((await app.inject({ url: "/api/card-catalog/products/inactive-visa" })).statusCode, 404); await app.close();
});
test("admin authorization, create, duplicate, product update, and provider update preserve contracts", async () => {
  const auditEvents: string[] = [];
  const auditActors: string[] = [];
  const app = buildApp({ isReady: () => true }, "silent", new InMemoryCatalogRepository([product]), secret, async ({ event, actor }) => { auditEvents.push(event); auditActors.push(`${actor.userId}:${actor.email}:${actor.role}:${actor.workspaceId}`); }, authUsers);
  assert.equal((await app.inject({ url: "/api/admin/card-catalog/products" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/admin/card-catalog/products", headers: { cookie: cookie("user", "u2") } })).statusCode, 403);
  const next = { ...product, presetId: "new-visa", sortOrder: 2 };
  const created = await app.inject({ method: "POST", url: "/api/admin/card-catalog/products", headers: { cookie: cookie() }, payload: next }); assert.equal(created.statusCode, 201); assert.equal(created.json().audit.updatedBy, "admin@example.test"); assert.equal(created.json().audit.storage, "mongodb:cardproducts");
  assert.equal(created.json().data.id, undefined);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/card-catalog/products", headers: { cookie: cookie() }, payload: next })).statusCode, 409);
  const updated = await app.inject({ method: "PATCH", url: "/api/admin/card-catalog/products/new-visa", headers: { cookie: cookie() }, payload: { annualFee: 200 } }); assert.equal(updated.json().data.annualFee, 200);
  const provider = await app.inject({ method: "PATCH", url: "/api/admin/card-catalog/providers/TST", headers: { cookie: cookie() }, payload: { providerName: "Renamed" } }); assert.equal(provider.json().data.affectedProducts, 2); assert.deepEqual(auditEvents, ["CATALOG_PRODUCT_CREATED", "CATALOG_PRODUCT_UPDATED", "CATALOG_PROVIDER_BULK_UPDATED"]); assert.deepEqual(auditActors, ["u1:admin@example.test:admin:w1", "u1:admin@example.test:admin:w1", "u1:admin@example.test:admin:w1"]); await app.close();
});
test("catalog admin routes fail closed for stale admin and missing auth repository", async () => {
  const repository = new InMemoryCatalogRepository([product]);
  const app = buildApp({ isReady: () => true }, "silent", repository, secret, async () => {}, authUsers);
  adminUser.role = "user";
  assert.equal((await app.inject({ url: "/api/admin/card-catalog/products", headers: { cookie: cookie() } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/card-catalog/products", headers: { cookie: cookie() }, payload: { ...product, presetId: "blocked" } })).statusCode, 403);
  adminUser.role = "admin";
  adminUser.active = false;
  assert.equal((await app.inject({ url: "/api/admin/card-catalog/products", headers: { cookie: cookie() } })).statusCode, 401);
  await app.close();
  const unconfigured = buildApp({ isReady: () => true }, "silent", repository, secret);
  assert.equal((await unconfigured.inject({ url: "/api/admin/card-catalog/products", headers: { cookie: cookie() } })).statusCode, 503);
  await unconfigured.close();
  adminUser.active = true;
});
test("catalog validator rejects invalid records and duplicate presetId", () => { const issues = validateCatalogProducts([product, { ...product, network: "Other", sortOrder: 2 }]); assert.ok(issues.some((i) => i.code === "DUPLICATE_PRESET_ID")); assert.ok(issues.some((i) => i.code === "INVALID_NETWORK")); });
