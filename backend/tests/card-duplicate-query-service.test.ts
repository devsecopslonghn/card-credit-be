import assert from "node:assert/strict";
import test from "node:test";
import { CreditCardModel } from "../src/models/credit-card.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { exactDuplicateCardGroups } from "../src/card-duplicate.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "duplicate-test" };
const card = (id: string, owner: string, presetId = "preset-a", active = true) => ({
  _id: id,
  workspaceId: "workspace-a",
  presetId,
  providerCode: "BANK",
  providerName: "Bank",
  displayName: "Card",
  network: "Visa",
  owner,
  active,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  monthlyData: [],
});
const query = <T>(value: T) => {
  const chain = { sort: () => chain, limit: () => chain, lean: async () => value };
  return chain;
};

test("duplicate query groups canonical cards by exact preset and normalized owner", async (t) => {
  const find = t.mock.method(CreditCardModel, "find", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a", active: { $ne: false } });
    return query([
      card("507f1f77bcf86cd799439011", "  Tôi   ", "preset-a", false),
      card("507f1f77bcf86cd799439012", "Tôi", "preset-a"),
      card("507f1f77bcf86cd799439013", "Tôi", "preset-b"),
      { ...card("507f1f77bcf86cd799439014", "Tôi"), presetId: undefined },
    ]) as never;
  });

  const result = await CardQueryService.listDuplicates(context);

  assert.equal(find.mock.callCount(), 1);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.normalizedOwner, "Tôi");
  assert.deepEqual(result[0]?.cards.map((item) => item.id), [
    "507f1f77bcf86cd799439011",
    "507f1f77bcf86cd799439012",
  ]);
  assert.equal(result[0]?.cards[0]?.active, false);
});

test("data integrity preflight groups only active exact duplicate cards deterministically", () => {
  assert.deepEqual(exactDuplicateCardGroups([
    { _id: "card-b", workspaceId: "workspace-a", presetId: "preset-a", owner: "  Tôi  " },
    { _id: "card-a", workspaceId: "workspace-a", presetId: "preset-a", owner: "Tôi", active: true },
    { _id: "card-retired", workspaceId: "workspace-a", presetId: "preset-a", owner: "Tôi", active: false },
    { _id: "card-other", workspaceId: "workspace-b", presetId: "preset-a", owner: "Tôi" },
  ]), [{ fingerprint: "workspace-a::preset-a::Tôi", cardIds: ["card-a", "card-b"] }]);
});
