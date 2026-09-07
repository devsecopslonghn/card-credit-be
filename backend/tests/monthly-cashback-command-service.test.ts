import assert from "node:assert/strict";
import test from "node:test";
import { MonthlyCardCashbackModel } from "../src/models/monthly-card-cashback.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { MonthlyCashbackCommandService } from "../src/services/monthly-cashback-command-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "cashback-command-test" };
const cardId = "507f1f77bcf86cd799439011";
const receivedAt = new Date("2026-07-20T01:02:03.000Z");

test("monthly cashback command preserves receivedAt and scopes upsert", async (t) => {
  const cardGet = t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  const existing = t.mock.method(MonthlyCardCashbackModel, "findOne", async () => ({ status: "RECEIVED", receivedAt }));
  const upsert = t.mock.method(MonthlyCardCashbackModel, "findOneAndUpdate", async (_filter: unknown, update: unknown) => update as never);
  await MonthlyCashbackCommandService.upsert(context, cardId, "2026-07", { expectedAmount: 120000, actualAmount: 110000, status: "RECEIVED", note: "  Đã nhận  " });

  const filter = { workspaceId: "workspace-a", userCardId: cardId, period: "2026-07" };
  assert.equal(cardGet.mock.callCount(), 1);
  assert.deepEqual(existing.mock.calls[0]?.arguments[0], filter);
  assert.deepEqual(upsert.mock.calls[0]?.arguments[0], filter);
  const update = upsert.mock.calls[0]?.arguments[1] as { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> };
  assert.equal(update.$set.actualAmount, 110000);
  assert.equal((update.$set.receivedAt as Date).toISOString(), receivedAt.toISOString());
  assert.equal(update.$set.note, "Đã nhận");
  assert.deepEqual(update.$setOnInsert, { workspaceId: "workspace-a", userId: "user-a", userCardId: cardId, period: "2026-07" });
  assert.deepEqual(upsert.mock.calls[0]?.arguments[2], { upsert: true, returnDocument: "after", runValidators: true });
});

test("monthly cashback delete uses the same tenant/card/period scope", async (t) => {
  t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  const remove = t.mock.method(MonthlyCardCashbackModel, "deleteOne", async () => ({ deletedCount: 0 }));
  await MonthlyCashbackCommandService.delete(context, cardId, "2026-07");
  assert.deepEqual(remove.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", userCardId: cardId, period: "2026-07" });
});
