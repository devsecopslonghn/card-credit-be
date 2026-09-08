import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { AccountModel } from "../src/models/account.js";
import { CardFeePaymentModel } from "../src/models/card-fee-payment.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { MonthlyCardCashbackModel } from "../src/models/monthly-card-cashback.js";
import { CardLifecycleService } from "../src/services/card-lifecycle-service.js";

const context = { workspaceId: "workspace-a", userId: "user-a", role: "user" as const, channel: "browser" as const, correlationId: "lifecycle-test" };
const base = (id: string, monthlyData: unknown[] = []) => ({
  _id: id, workspaceId: "workspace-a", presetId: "preset-a", providerCode: "BANK", providerName: "Bank", displayName: "Visa", network: "Visa", owner: "Alice", active: true, monthlyData,
});
const query = (value: unknown) => ({ lean: async () => value });

test("card retirement is reversible and never deletes the card", async (t) => {
  t.mock.method(CreditCardModel, "findOne", () => query(base("507f1f77bcf86cd799439011")) as never);
  const update = t.mock.method(CreditCardModel, "findOneAndUpdate", () => ({ lean: async () => ({ _id: "507f1f77bcf86cd799439011" }) }) as never);
  const result = await CardLifecycleService.retire(context, "507f1f77bcf86cd799439011");
  assert.deepEqual(result, { retired: true, id: "507f1f77bcf86cd799439011" });
  assert.deepEqual(update.mock.calls[0]?.arguments[1], { $set: { active: false, retiredAt: update.mock.calls[0]?.arguments[1] && (update.mock.calls[0]?.arguments[1] as { $set: { retiredAt: Date } }).$set.retiredAt } });
});

test("duplicate merge preserves referenced history by refusing unsafe source", async (t) => {
  const source = base("507f1f77bcf86cd799439011", [{ month: 1, spend: 10 }]);
  const target = base("507f1f77bcf86cd799439012", [{ month: 1, spend: 20 }]);
  const docs = [source, target];
  const cards = t.mock.method(CreditCardModel, "findOne", () => query(docs.shift()) as never);
  const update = t.mock.method(CreditCardModel, "findOneAndUpdate", () => ({ lean: async () => target }) as never);
  t.mock.method(AccountModel, "countDocuments", async () => 0);
  t.mock.method(CardStatementModel, "countDocuments", async () => 1);
  t.mock.method(MonthlyCardCashbackModel, "countDocuments", async () => 0);
  t.mock.method(CardFeePaymentModel, "countDocuments", async () => 0);
  await assert.rejects(() => CardLifecycleService.merge(context, source._id, target._id), (error: unknown) => (error as { code?: string }).code === "CARD_MERGE_HAS_HISTORY");
  assert.equal(update.mock.callCount(), 0);
  assert.equal(cards.mock.callCount(), 2);
});

test("safe duplicate merge updates target and retires source in one transaction", async (t) => {
  const source = base("507f1f77bcf86cd799439011", [{ month: 1, spend: 10 }]);
  const target = base("507f1f77bcf86cd799439012", [{ month: 1, spend: 20 }]);
  const docs = [source, target];
  t.mock.method(CreditCardModel, "findOne", () => query(docs.shift()) as never);
  const updatedTarget = { ...target, monthlyData: [{ month: 1, spend: 30, cashback: 0, fee: 0, otherInterest: 0 }] };
  t.mock.method(CreditCardModel, "findOneAndUpdate", () => ({ lean: async () => updatedTarget }) as never);
  const updateSource = t.mock.method(CreditCardModel, "updateOne", async () => ({ modifiedCount: 1 }) as never);
  t.mock.method(AccountModel, "countDocuments", async () => 0);
  t.mock.method(CardStatementModel, "countDocuments", async () => 0);
  t.mock.method(MonthlyCardCashbackModel, "countDocuments", async () => 0);
  t.mock.method(CardFeePaymentModel, "countDocuments", async () => 0);
  const fakeSession = { withTransaction: async (work: (session: unknown) => Promise<void>) => work(fakeSession), endSession: async () => {} };
  t.mock.method(mongoose, "startSession", async () => fakeSession as never);
  const result = await CardLifecycleService.merge(context, source._id, target._id);
  assert.equal(result.retiredSourceId, source._id);
  assert.equal(result.targetCard.id, target._id);
  assert.equal(result.targetCard.monthlyData[0]?.spend, 30);
  assert.equal(updateSource.mock.callCount(), 1);
});
