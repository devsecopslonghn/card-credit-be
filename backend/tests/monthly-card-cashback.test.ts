import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { MonthlyCardCashbackModel } from "../src/models/monthly-card-cashback.js";
import { registerMonthlyCardCashbackRoutes } from "../src/monthly-card-cashback-routes.js";
import { MonthlyCashbackQueryService } from "../src/services/monthly-cashback-query-service.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const cardId = "507f1f77bcf86cd799439011";
const users = { findUserById: async (id: string) => id === "user-1" ? { id, email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null } : null };
const cookie = sessionCookie(
  signSession(
    {
      userId: "user-1",
      email: "user@example.test",
      role: "user",
      workspaceId: "workspace-a",
    },
    secret,
  ),
);

const appWithRoutes = () => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerMonthlyCardCashbackRoutes(app, secret, users);
  return app;
};

test("monthly cashback routes require a session before database access", async (t) => {
  const cardFind = t.mock.method(CreditCardModel, "findOne");
  const app = appWithRoutes();
  for (const request of [
    {
      method: "GET",
      url: `/api/cards/${cardId}/monthly-cashbacks?year=2026`,
    },
    {
      method: "PUT",
      url: `/api/cards/${cardId}/monthly-cashbacks/2026-07`,
      payload: { expectedAmount: 1000, status: "PENDING" },
    },
    {
      method: "DELETE",
      url: `/api/cards/${cardId}/monthly-cashbacks/2026-07`,
    },
  ] as const) {
    assert.equal((await app.inject(request)).statusCode, 401);
  }
  assert.equal(cardFind.mock.callCount(), 0);
  await app.close();
});

test("model declares the per-workspace card-period unique index", () => {
  const unique = MonthlyCardCashbackModel.schema
    .indexes()
    .find(
      (entry: [Record<string, number>, { unique?: boolean }]) =>
        entry[1].unique,
    );
  assert.deepEqual(unique?.[0], {
    workspaceId: 1,
    userCardId: 1,
    period: 1,
  });
});

test("GET validates year and scopes card and cashback queries to workspace", async (t) => {
  const app = appWithRoutes();
  const invalid = await app.inject({
    method: "GET",
    url: `/api/cards/${cardId}/monthly-cashbacks?year=26`,
    headers: { cookie },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "INVALID_YEAR");
  await app.close();

  const list = t.mock.method(
    MonthlyCashbackQueryService,
    "list",
    async (context: ServiceContext, requestedCardId: string, year: string) => {
      assert.equal(context.workspaceId, "workspace-a");
      assert.equal(requestedCardId, cardId);
      assert.equal(year, "2026");
      return [{
        id: "cashback-1",
        cardId,
        period: "2026-07",
        expectedAmount: 120000,
        actualAmount: null,
        status: "PENDING",
        receivedAt: null,
        note: "",
      }];
    },
  );
  const mockedApp = appWithRoutes();
  const response = await mockedApp.inject({
    method: "GET",
    url: `/api/cards/${cardId}/monthly-cashbacks?year=2026`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data[0].period, "2026-07");
  assert.equal(list.mock.callCount(), 1);
  await mockedApp.close();
});

test("PUT validates payload and performs a workspace-scoped idempotent upsert", async (t) => {
  t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  const existingFind = t.mock.method(
    MonthlyCardCashbackModel,
    "findOne",
    async () => null,
  );
  const upsert = t.mock.method(
    MonthlyCardCashbackModel,
    "findOneAndUpdate",
    async (_filter: unknown, update: unknown) => ({
      _id: "cashback-1",
      ...(update as { $setOnInsert: object }).$setOnInsert,
      ...(update as { $set: object }).$set,
    }),
  );
  const app = appWithRoutes();
  const response = await app.inject({
    method: "PUT",
    url: `/api/cards/${cardId}/monthly-cashbacks/2026-07`,
    headers: { cookie },
    payload: {
      expectedAmount: 120000,
      actualAmount: 999999,
      status: "PENDING",
      note: "  Chờ ngân hàng  ",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.actualAmount, null);
  assert.equal(response.json().data.receivedAt, null);
  assert.equal(response.json().data.note, "Chờ ngân hàng");
  const filter = {
    workspaceId: "workspace-a",
    userCardId: cardId,
    period: "2026-07",
  };
  assert.deepEqual(existingFind.mock.calls[0]?.arguments[0], filter);
  assert.deepEqual(upsert.mock.calls[0]?.arguments[0], filter);
  assert.deepEqual(
    (upsert.mock.calls[0]?.arguments[1] as { $setOnInsert: object })
      .$setOnInsert,
    {
      workspaceId: "workspace-a",
      userId: "user-1",
      userCardId: cardId,
      period: "2026-07",
    },
  );
  assert.deepEqual(upsert.mock.calls[0]?.arguments[2], {
    upsert: true,
    returnDocument: "after",
    runValidators: true,
  });
  await app.close();
});

test("RECEIVED requires actual amount and preserves receivedAt on repeated PUT", async (t) => {
  const receivedAt = new Date("2026-07-20T01:02:03.000Z");
  t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  t.mock.method(MonthlyCardCashbackModel, "findOne", async () => ({
    status: "RECEIVED",
    receivedAt,
  }));
  const upsert = t.mock.method(
    MonthlyCardCashbackModel,
    "findOneAndUpdate",
    async (_filter: unknown, update: unknown) =>
      (update as { $set: object }).$set,
  );
  const app = appWithRoutes();

  const missing = await app.inject({
    method: "PUT",
    url: `/api/cards/${cardId}/monthly-cashbacks/2026-07`,
    headers: { cookie },
    payload: { expectedAmount: 120000, status: "RECEIVED" },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "INVALID_CASHBACK");

  const response = await app.inject({
    method: "PUT",
    url: `/api/cards/${cardId}/monthly-cashbacks/2026-07`,
    headers: { cookie },
    payload: {
      expectedAmount: 120000,
      actualAmount: 110000,
      status: "RECEIVED",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.receivedAt, receivedAt.toISOString());
  assert.equal(
    (
      upsert.mock.calls[0]?.arguments[1] as {
        $set: { actualAmount: number };
      }
    ).$set.actualAmount,
    110000,
  );
  await app.close();
});

test("PUT rejects invalid period, status, and non-integer or negative VND", async (t) => {
  t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  const app = appWithRoutes();
  const cases = [
    {
      period: "2026-13",
      payload: { expectedAmount: 1, status: "PENDING" },
      code: "INVALID_PERIOD",
    },
    {
      period: "2026-07",
      payload: { expectedAmount: 1, status: "PAID" },
      code: "INVALID_CASHBACK_STATUS",
    },
    {
      period: "2026-07",
      payload: { expectedAmount: 1.5, status: "PENDING" },
      code: "INVALID_CASHBACK",
    },
    {
      period: "2026-07",
      payload: { expectedAmount: -1, status: "PENDING" },
      code: "INVALID_CASHBACK",
    },
  ];
  for (const item of cases) {
    const response = await app.inject({
      method: "PUT",
      url: `/api/cards/${cardId}/monthly-cashbacks/${item.period}`,
      headers: { cookie },
      payload: item.payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, item.code);
  }
  await app.close();
});

test("missing or cross-workspace cards return CARD_NOT_FOUND before record access", async (t) => {
  t.mock.method(CreditCardModel, "findOne", () => ({ lean: async () => null }) as never);
  const cashbackFind = t.mock.method(MonthlyCardCashbackModel, "find");
  const app = appWithRoutes();
  const response = await app.inject({
    method: "GET",
    url: `/api/cards/${cardId}/monthly-cashbacks?year=2026`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "CARD_NOT_FOUND");
  assert.equal(cashbackFind.mock.callCount(), 0);
  await app.close();
});

test("DELETE scopes the mutation to workspace, card, and period", async (t) => {
  t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  const remove = t.mock.method(
    MonthlyCardCashbackModel,
    "deleteOne",
    async () => ({ deletedCount: 1 }),
  );
  const app = appWithRoutes();
  const response = await app.inject({
    method: "DELETE",
    url: `/api/cards/${cardId}/monthly-cashbacks/2026-07`,
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(remove.mock.calls[0]?.arguments[0], {
    workspaceId: "workspace-a",
    userCardId: cardId,
    period: "2026-07",
  });
  await app.close();
});
