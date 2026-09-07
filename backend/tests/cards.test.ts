import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { registerCardRoutes } from "../src/card-routes.js";
import { sessionCookie, signSession } from "../src/auth.js";
import { cardPortfolioCardSchema } from "@card-credit/contracts";
import { CardQueryService, cardDtoFromDocument } from "../src/services/card-query-service.js";
import { legacyCardResponse } from "../src/card-routes.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const cookie = sessionCookie(signSession({ userId: "user-1", email: "user@example.test", role: "user", workspaceId: "workspace-a" }, secret));

test("card routes require authentication and validate requests before database access", async () => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerCardRoutes(app, secret);
  for (const request of [
    { method: "GET", url: "/api/cards" },
    { method: "POST", url: "/api/cards", payload: {} },
    { method: "GET", url: "/api/cards/duplicates" },
  ] as const) assert.equal((await app.inject(request)).statusCode, 401);
  const invalidId = await app.inject({ method: "GET", url: "/api/cards/not-an-id", headers: { cookie } });
  assert.equal(invalidId.statusCode, 400);
  assert.equal(invalidId.json().error.code, "INVALID_CARD_ID");
  const invalidCreate = await app.inject({ method: "POST", url: "/api/cards", headers: { cookie }, payload: {} });
  assert.equal(invalidCreate.statusCode, 400);
  assert.equal(invalidCreate.json().error.code, "INVALID_REQUEST");
  await app.close();
});

test("card query DTO and REST compatibility adapter preserve the same portfolio fields", () => {
  const dto = cardDtoFromDocument({
    _id: "507f1f77bcf86cd799439011",
    presetId: "test-visa",
    providerCode: "TST",
    providerName: "Test Bank",
    displayName: "Test Visa",
    network: "Visa",
    owner: "Tôi",
    active: false,
    monthlyData: [{ month: 1, spend: 100, cashback: 2, fee: 3, otherInterest: 0 }],
  });
  const rest = legacyCardResponse(dto);
  const parsed = cardPortfolioCardSchema.parse({ ...rest, id: rest._id });
  assert.equal(parsed.id, dto.id);
  assert.equal(parsed.providerName, dto.providerName);
  assert.equal(parsed.active, false);
  assert.deepEqual(parsed.monthlyData, dto.monthlyData);
});

test("duplicate REST read delegates trusted context and keeps only compatibility card aliases", async (t) => {
  const listDuplicates = t.mock.method(CardQueryService, "listDuplicates", async (context: ServiceContext) => {
    assert.equal(context.workspaceId, "workspace-a");
    return [{
      fingerprint: "workspace-a::preset-a::Tôi",
      presetId: "preset-a",
      normalizedOwner: "Tôi",
      reason: "Same workspace, catalog preset and normalized owner.",
      cards: [cardDtoFromDocument({
        _id: "507f1f77bcf86cd799439011",
        presetId: "preset-a",
        providerCode: "TST",
        providerName: "Test Bank",
        displayName: "Test Visa",
        network: "Visa",
        owner: "Tôi",
        monthlyData: [],
      }), cardDtoFromDocument({
        _id: "507f1f77bcf86cd799439012",
        presetId: "preset-a",
        providerCode: "TST",
        providerName: "Test Bank",
        displayName: "Test Visa",
        network: "Visa",
        owner: "Tôi",
        monthlyData: [],
      })],
    }];
  });
  const app = buildApp({ isReady: () => true }, "silent");
  registerCardRoutes(app, secret);
  const response = await app.inject({ method: "GET", url: "/api/cards/duplicates", headers: { cookie } });
  assert.equal(response.statusCode, 200);
  const body = response.json().data[0];
  assert.equal(body.cards[0]._id, "507f1f77bcf86cd799439011");
  assert.equal("workspaceId" in body, false);
  assert.equal(listDuplicates.mock.callCount(), 1);
  await app.close();
});
