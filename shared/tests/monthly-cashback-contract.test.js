import assert from "node:assert/strict";
import test from "node:test";
import { monthlyCashbackListSchema, monthlyCashbackSchema } from "../src/index.js";

test("monthly cashback contract exposes canonical read fields and normalizes calendar periods", () => {
  assert.deepEqual(monthlyCashbackSchema.parse({
    id: "cb-1",
    cardId: "card-1",
    period: "2026-07",
    expectedAmount: 120000,
    actualAmount: null,
    status: "PENDING",
    receivedAt: null,
    note: "Chờ nhận",
  }), {
    id: "cb-1",
    cardId: "card-1",
    period: "2026-07",
    expectedAmount: 120000,
    actualAmount: null,
    status: "PENDING",
    receivedAt: null,
    note: "Chờ nhận",
  });
  assert.deepEqual(monthlyCashbackListSchema.parse([{
    id: "cb-2",
    cardId: "card-1",
    period: "2026-02",
    expectedAmount: 120000,
    actualAmount: 110000,
    status: "RECEIVED",
    receivedAt: "2026-03-01T00:00:00.000Z",
    note: "Đã nhận",
  }]).length, 1);
  assert.throws(() => monthlyCashbackSchema.parse({
    id: "cb-3",
    cardId: "card-1",
    period: "2026-02",
    expectedAmount: 120000,
    actualAmount: -1,
    status: "REJECTED",
    receivedAt: null,
    note: "",
  }));
  assert.throws(() => monthlyCashbackSchema.parse({
    id: "cb-4",
    cardId: "card-1",
    period: "2026-13",
    expectedAmount: 120000,
    actualAmount: null,
    status: "PENDING",
    receivedAt: null,
    note: "",
  }));
});
