import assert from "node:assert/strict";
import test from "node:test";
import { MonthlyCardCashbackModel } from "../src/models/monthly-card-cashback.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { MonthlyCashbackQueryService } from "../src/services/monthly-cashback-query-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "cashback-query-test" };
const cardId = "507f1f77bcf86cd799439011";
const query = <T>(value: T) => {
  const chain = { sort: () => chain, lean: async () => value };
  return chain;
};

test("cashback read delegates card ownership and returns canonical DTOs", async (t) => {
  const cardGet = t.mock.method(CardQueryService, "get", async (ctx: ServiceContext, requestedCardId: string) => {
    assert.equal(ctx.workspaceId, context.workspaceId);
    assert.equal(requestedCardId, cardId);
    return { id: cardId } as never;
  });
  const cashbackFind = t.mock.method(MonthlyCardCashbackModel, "find", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, {
      workspaceId: "workspace-a",
      userCardId: cardId,
      period: { $gte: "2026-01", $lte: "2026-12" },
    });
    return query([
      {
        _id: "cashback-1",
        userCardId: cardId,
        period: "2026-07",
        expectedAmount: 120000,
        actualAmount: 110000,
        status: "RECEIVED",
        receivedAt: new Date("2026-08-01T00:00:00.000Z"),
        note: "Đã nhận",
      },
      {
        _id: "cashback-2",
        userCardId: cardId,
        period: "2026-06",
        expectedAmount: 50000,
        actualAmount: 50000,
        status: "REJECTED",
        receivedAt: null,
        note: "",
      },
    ]) as never;
  });

  const result = await MonthlyCashbackQueryService.list(context, cardId, "2026");

  assert.deepEqual(result, [
    {
      id: "cashback-1",
      cardId,
      period: "2026-07",
      expectedAmount: 120000,
      actualAmount: 110000,
      status: "RECEIVED",
      receivedAt: "2026-08-01T00:00:00.000Z",
      note: "Đã nhận",
    },
    {
      id: "cashback-2",
      cardId,
      period: "2026-06",
      expectedAmount: 50000,
      actualAmount: null,
      status: "REJECTED",
      receivedAt: null,
      note: "",
    },
  ]);
  assert.equal(cardGet.mock.callCount(), 1);
  assert.equal(cashbackFind.mock.callCount(), 1);
});

test("cashback query rejects malformed card id and year before service reads", async (t) => {
  const cardGet = t.mock.method(CardQueryService, "get");
  const cashbackFind = t.mock.method(MonthlyCardCashbackModel, "find");
  await assert.rejects(
    MonthlyCashbackQueryService.list(context, "not-an-object-id", "2026"),
    (error: unknown) => (error as { code?: string }).code === "INVALID_CARD_ID",
  );
  await assert.rejects(
    MonthlyCashbackQueryService.list(context, cardId, "26"),
    (error: unknown) => (error as { code?: string }).code === "INVALID_YEAR",
  );
  assert.equal(cardGet.mock.callCount(), 0);
  assert.equal(cashbackFind.mock.callCount(), 0);
});
