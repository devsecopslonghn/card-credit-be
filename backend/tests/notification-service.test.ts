import assert from "node:assert/strict";
import test from "node:test";
import { NotificationService, type NotificationDependencies } from "../src/services/notification-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = {
  userId: "user-1", workspaceId: "workspace-a", role: "user", channel: "browser", correlationId: "request-1",
};

test("notification service clamps limit and maps canonical status with card fallback", async () => {
  let receivedLimit = 0;
  const dependencies: NotificationDependencies = {
    listStatements: async (_context, limit) => {
      receivedLimit = limit;
      return [
        { id: "statement-1", effectivePaymentStatus: "PAID", paymentDueDate: "2026-07-15", paymentStatus: "PAID", cardId: "card-1" },
        { id: "statement-2", effectivePaymentStatus: "OPEN", paymentDueDate: "2026-08-15", paymentStatus: "OPEN", cardId: "orphan" },
      ];
    },
    listCards: async () => [{ id: "card-1", providerName: "Bank A", displayName: "Card A" }],
  };

  const result = await NotificationService.list(context, "200", dependencies);
  assert.equal(receivedLimit, 100);
  assert.deepEqual(result.data.map((item) => ({ status: item.status, message: item.message })), [
    { status: "success", message: "Bank A · Card A" },
    { status: "warning", message: "Thẻ tín dụng" },
  ]);
  assert.deepEqual(result.meta, { limit: 100, source: "card_statements" });
});

test("notification service keeps default limit and delegates the trusted context", async () => {
  let seenContext: ServiceContext | undefined;
  let seenLimit = 0;
  const dependencies: NotificationDependencies = {
    listStatements: async (serviceContext, limit) => { seenContext = serviceContext; seenLimit = limit; return []; },
    listCards: async () => [],
  };
  const result = await NotificationService.list(context, undefined, dependencies);
  assert.equal(seenContext, context);
  assert.equal(seenLimit, 50);
  assert.deepEqual(result, { data: [], meta: { limit: 50, source: "card_statements" } });
});
