import assert from "node:assert/strict";
import test from "node:test";
import { hashSubscriptionToken } from "../src/calendar-subscription.js";
import { CalendarSubscriptionModel } from "../src/models/calendar-subscription.js";
import { CalendarSubscriptionService } from "../src/services/calendar-subscription-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "calendar-command-test" };
const subscriptionId = "507f1f77bcf86cd799439011";

test("calendar subscriptions enforce one non-empty device label per workspace", () => {
  const indexes = CalendarSubscriptionModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; unique?: boolean; partialFilterExpression?: Record<string, unknown> }]>;
  const index = indexes.find(([, options]) => options.name === "calendar_subscription_user_workspace_device_unique");
  assert.deepEqual(index, [
    { userId: 1, workspaceId: 1, deviceLabel: 1 },
    { name: "calendar_subscription_user_workspace_device_unique", unique: true, partialFilterExpression: { deviceLabel: { $type: "string" } } },
  ]);
});

test("calendar subscription create stores only a hash and returns the one-time feed path", async (t) => {
  const create = t.mock.method(CalendarSubscriptionModel, "create", async (value: Record<string, unknown>) => ({
    toObject: () => ({ _id: subscriptionId, ...value, createdAt: new Date("2026-08-16T00:00:00.000Z") }),
  }) as never);
  const result = await CalendarSubscriptionService.create(context, "  iPhone   cá nhân  ");
  const input = create.mock.calls[0]?.arguments[0] as Record<string, unknown>;
  const token = String(result.subscriptionPath).split("/").pop()?.replace(".ics", "");
  assert.equal(input.userId, "user-a");
  assert.equal(input.workspaceId, "workspace-a");
  assert.equal(input.deviceLabel, "iPhone cá nhân");
  assert.equal(typeof input.tokenHash, "string");
  assert.equal(input.tokenHash, hashSubscriptionToken(token ?? ""));
  assert.equal("tokenHash" in result, false);
  assert.equal(result.createdAt, "2026-08-16T00:00:00.000Z");
  assert.match(String(result.subscriptionPath), /^\/api\/calendar-subscriptions\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
});

test("calendar subscription create validates labels and revoke scopes the active subscription", async (t) => {
  const create = t.mock.method(CalendarSubscriptionModel, "create");
  await assert.rejects(
    () => CalendarSubscriptionService.create(context, "bad\nlabel"),
    (error: unknown) => (error as { code?: string }).code === "INVALID_DEVICE_LABEL",
  );
  assert.equal(create.mock.callCount(), 0);

  const update = t.mock.method(CalendarSubscriptionModel, "updateOne", async () => ({ modifiedCount: 1 }));
  assert.deepEqual(await CalendarSubscriptionService.revoke(context, subscriptionId), { revoked: true });
  assert.deepEqual(update.mock.calls[0]?.arguments[0], { _id: subscriptionId, userId: "user-a", workspaceId: "workspace-a", revokedAt: null });
  assert.deepEqual(update.mock.calls[0]?.arguments[1], { $set: { revokedAt: update.mock.calls[0]?.arguments[1] && (update.mock.calls[0]?.arguments[1] as { $set: { revokedAt: Date } }).$set.revokedAt } });
  assert.ok((update.mock.calls[0]?.arguments[1] as { $set: { revokedAt: unknown } }).$set.revokedAt instanceof Date);
});

test("calendar subscription revoke rejects malformed or missing ids without writing", async (t) => {
  const update = t.mock.method(CalendarSubscriptionModel, "updateOne");
  await assert.rejects(() => CalendarSubscriptionService.revoke(context, "not-an-object-id"), /Không tìm thấy lịch đăng ký/);
  assert.equal(update.mock.callCount(), 0);
});
