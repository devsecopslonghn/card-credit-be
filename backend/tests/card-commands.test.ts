import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogProduct, CatalogRepository } from "../src/catalog.js";
import { CardCommandService, type CardWriteRepository } from "../src/services/card-command-service.js";

const product: CatalogProduct = {
  presetId: "test-visa",
  providerCode: "TST",
  providerName: "Test Bank",
  displayName: "Test Visa",
  network: "Visa",
  segment: "Classic",
  annualFee: 100,
  targetSpendForWaiver: 1_000,
  imageUrl: null,
  benefits: [],
  sourceUrl: "https://example.test/card",
  sourceCheckedAt: "2026-07-11",
  active: true,
  sortOrder: 1,
  theme: { background: "#000", accent: "#fff" },
};
const context = { workspaceId: "workspace-a", userId: "user-a", role: "user" as const, channel: "browser" as const, correlationId: "test-correlation" };

class FakeCards implements CardWriteRepository {
  readonly docs: Array<Record<string, unknown>> = [];
  async create(input: Record<string, unknown>) { const doc = { ...input, _id: input._id ?? `card-${this.docs.length + 1}` }; this.docs.push(doc); return doc; }
  async findOne(filter: Record<string, unknown>) { return this.docs.find((doc) => Object.entries(filter).every(([key, value]) => doc[key] === value)) ?? null; }
  async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>) { const doc = await this.findOne(filter); if (!doc) return null; Object.assign(doc, update.$set as Record<string, unknown>); return doc; }
}

const catalog = { listAllProducts: async () => [product] } as CatalogRepository;

test("card create command snapshots active catalog data and trusted tenancy", async () => {
  const cards = new FakeCards();
  const result = await CardCommandService.create(context, { presetId: "test-visa", owner: "  Alice   Nguyen " }, catalog, cards);
  assert.equal(result.providerName, "Test Bank");
  assert.equal(result.owner, "Alice Nguyen");
  assert.equal(cards.docs[0]?.workspaceId, "workspace-a");
  assert.equal(cards.docs[0]?.userId, "user-a");
  assert.equal(cards.docs[0]?.annualFeeWaiverTarget, 1_000);
});

test("legacy create remains available behind the compatibility command", async () => {
  const cards = new FakeCards();
  const result = await CardCommandService.create(context, { bank: "OLD", name: "Old Card", type: "Visa", imageUrl: "/old.svg", annualFee: 0, owner: "Owner" }, catalog, cards);
  assert.equal(result.legacy, true);
  assert.equal(result.providerCode, "OLD");
  assert.equal(cards.docs[0]?.workspaceId, "workspace-a");
});

test("card update command scopes workspace and ignores catalog snapshot fields", async () => {
  const cards = new FakeCards();
  await cards.create({ _id: "507f1f77bcf86cd799439011", workspaceId: "workspace-a", providerName: "Original", bank: "TST", name: "Card", type: "Visa", owner: "Old", imageUrl: "/card.svg" });
  const result = await CardCommandService.update(context, "507f1f77bcf86cd799439011", { owner: " New Owner ", providerName: "Tampered" }, cards);
  assert.equal(result.owner, "New Owner");
  assert.equal(result.providerName, "Original");
  await assert.rejects(() => CardCommandService.update({ ...context, workspaceId: "workspace-b" }, "507f1f77bcf86cd799439011", { owner: "Nope" }, cards), (error) => (error as { code?: string }).code === "CARD_NOT_FOUND");
});
