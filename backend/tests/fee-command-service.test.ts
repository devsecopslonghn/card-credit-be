import assert from "node:assert/strict";
import test from "node:test";
import { CardFeePaymentModel } from "../src/models/card-fee-payment.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { FeeCommandService } from "../src/services/fee-command-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "fee-command-test" };
const cardId = "507f1f77bcf86cd799439011";
const paymentId = "507f1f77bcf86cd799439012";

test("Fee Center commands preserve compatibility payload and delete response", async (t) => {
  t.mock.method(CardQueryService, "get", async () => ({ id: cardId } as never));
  const create = t.mock.method(CardFeePaymentModel, "create", async (value: Record<string, unknown>) => value as never);
  await FeeCommandService.createCenter(context, { cardId, category: "MANAGEMENT_FEE", paymentDate: "2026-07-23", amount: 100000, note: null });
  assert.deepEqual(create.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a", userId: "user-a", userCardId: cardId, category: "MANAGEMENT_FEE", paymentDate: "2026-07-23", amount: 100000, note: "" });

  const update = t.mock.method(CardFeePaymentModel, "findOneAndUpdate", async (_filter: unknown, value: unknown) => value as never);
  await FeeCommandService.updateCenter(context, paymentId, { category: "OTHER_FEE", paymentDate: "2026-07-24", amount: 200000 });
  assert.deepEqual((update.mock.calls[0]?.arguments[1] as { $set: object }).$set, { userCardId: undefined, category: "OTHER_FEE", paymentDate: "2026-07-24", amount: 200000, note: "" });

  const remove = t.mock.method(CardFeePaymentModel, "deleteOne", async () => ({ deletedCount: 0 }));
  assert.deepEqual(await FeeCommandService.deleteCenter(context, paymentId), { deletedId: paymentId });
  assert.deepEqual(remove.mock.calls[0]?.arguments[0], { _id: paymentId, workspaceId: "workspace-a" });
});
