import assert from "node:assert/strict";
import test from "node:test";
import { CardFeePaymentModel } from "../src/models/card-fee-payment.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { FeeQueryService } from "../src/services/fee-query-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "browser", correlationId: "fee-query-test" };
const cardId = "507f1f77bcf86cd799439011";
const query = <T>(value: T) => {
  const chain = { sort: () => chain, limit: () => chain, lean: async () => value };
  return chain;
};
const card = { id: cardId, providerName: "Bank A", displayName: "Visa A", owner: "Tôi" };

test("card fee read delegates card ownership and returns canonical FeePaymentDto", async (t) => {
  const cardGet = t.mock.method(CardQueryService, "get", async (ctx: ServiceContext, requestedCardId: string) => {
    assert.equal(ctx.workspaceId, context.workspaceId);
    assert.equal(requestedCardId, cardId);
    return { ...card } as never;
  });
  const feeFind = t.mock.method(CardFeePaymentModel, "find", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a", userCardId: cardId });
    return query([{ _id: "fee-1", userCardId: cardId, category: "ANNUAL_CARD_FEE", paymentDate: "2026-07-23", amount: 299000, note: "Phí năm" }]) as never;
  });

  const result = await FeeQueryService.listCardPayments(context, cardId);

  assert.deepEqual(result, [{ id: "fee-1", cardId, category: "ANNUAL_CARD_FEE", paymentDate: "2026-07-23", amount: 299000, note: "Phí năm" }]);
  assert.equal(cardGet.mock.callCount(), 1);
  assert.equal(feeFind.mock.callCount(), 1);
});

test("Fee Center read shares workspace/card DTOs and preserves orphan records as null card", async (t) => {
  const cardList = t.mock.method(CardQueryService, "list", async (ctx: ServiceContext) => {
    assert.equal(ctx.workspaceId, "workspace-a");
    return [card] as never;
  });
  const feeFind = t.mock.method(CardFeePaymentModel, "find", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { workspaceId: "workspace-a", category: "MANAGEMENT_FEE" });
    return query([
      { _id: "fee-1", userCardId: cardId, category: "MANAGEMENT_FEE", paymentDate: "2026-07-23", amount: 100000, note: "" },
      { _id: "fee-orphan", userCardId: "507f1f77bcf86cd799439099", category: "MANAGEMENT_FEE", paymentDate: "2026-07-22", amount: 50000, note: "legacy" },
    ]) as never;
  });

  const result = await FeeQueryService.listCenter(context, { category: "MANAGEMENT_FEE" });

  assert.equal(result.length, 2);
  assert.deepEqual(result[0]?.card, { id: cardId, providerName: "Bank A", displayName: "Visa A", owner: "Tôi" });
  assert.equal(result[1]?.card, null);
  assert.equal(cardList.mock.callCount(), 1);
  assert.equal(feeFind.mock.callCount(), 1);
});
