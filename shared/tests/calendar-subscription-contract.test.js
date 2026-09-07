import assert from "node:assert/strict";
import test from "node:test";
import { calendarSubscriptionCreateSchema, calendarSubscriptionListSchema } from "../src/index.js";

const item = { id: "subscription-1", deviceLabel: "Laptop", createdAt: "2026-08-16T00:00:00.000Z", lastAccessedAt: null, revokedAt: null };
const subscriptionPath = `/api/calendar-subscriptions/feed/${"a".repeat(43)}.ics`;

test("calendar subscription schemas validate safe ISO DTOs and one-time create path", () => {
  assert.deepEqual(calendarSubscriptionListSchema.parse([item]), [item]);
  assert.deepEqual(calendarSubscriptionCreateSchema.parse({ ...item, subscriptionPath }), { ...item, subscriptionPath });
  assert.throws(() => calendarSubscriptionListSchema.parse([{ ...item, createdAt: "2026-08-16" }]));
  assert.throws(() => calendarSubscriptionListSchema.parse([{ ...item, tokenHash: "secret" }]));
  assert.throws(() => calendarSubscriptionCreateSchema.parse({ ...item, subscriptionPath: "/api/calendar-subscriptions/feed/not-a-token.ics" }));
});
