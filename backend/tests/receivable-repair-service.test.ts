import assert from "node:assert/strict";
import test from "node:test";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { McpMutationModel } from "../src/models/mcp-mutation.js";
import { commandGuardService } from "../src/services/command-guard-service.js";
import { ReceivableRepairService } from "../src/services/receivable-repair-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";
import type { CommandGuardSpec } from "../src/services/command-guard-service.js";
import mongoose from "mongoose";

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "mcp", correlationId: "receivable-repair-test" };
const input = { transactionId: "receivable-source", amount: 15_801_397, reason: "Master xác nhận đã thu trước đó", expectedVersion: 0 };

test("receivable preview is status-only and has zero financial impact", async (t) => {
  t.mock.method(FinancialTransactionModel, "find", () => ({ lean: async () => [{ _id: "receivable-source", transactionType: "EXPENSE", ownership: "PAID_FOR_OTHER", reimbursementExpected: 15_801_397, receivableVersion: 0 }] }) as never);
  const result = await ReceivableRepairService.preview(context, input);
  assert.equal(result.beforeStatus, "OPEN");
  assert.equal(result.afterStatus, "SETTLED");
  assert.equal(result.amount, 15_801_397);
  assert.equal(result.cashDelta, 0);
  assert.equal(result.creditDebtDelta, 0);
  assert.equal(result.personalSpending, 0);
  assert.equal(result.realIncome, 0);
  assert.equal(result.operatingCashflow, 0);
  assert.equal(result.serviceFee, 0);
  assert.equal(result.technicalRepair, true);
});

test("receivable confirm only updates status and is guarded", async (t) => {
  t.mock.method(McpMutationModel, "findOne", () => ({ session() { return this; }, lean: async () => null }) as never);
  let update: Record<string, unknown> | undefined;
  t.mock.method(FinancialTransactionModel, "findOneAndUpdate", ((_filter: unknown, change: Record<string, unknown>) => {
    update = change;
    return { session() { return this; }, lean: async () => ({ _id: "receivable-source" }) };
  }) as never);
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: CommandGuardSpec, work: (session: mongoose.ClientSession) => Promise<unknown>) => work({} as mongoose.ClientSession));
  const result = await ReceivableRepairService.confirm(context, input, { idempotencyKey: "settle-receivable-1", endpointOrTool: "confirm_settle_receivable" });
  assert.equal((result as { financialTransactionCreated: boolean }).financialTransactionCreated, false);
  assert.deepEqual(update?.$set, { receivableStatus: "SETTLED", receivableSettledAmount: 15_801_397, receivableSettledAt: update?.$set && (update.$set as Record<string, unknown>).receivableSettledAt, receivableSettlementReason: input.reason });
  assert.deepEqual(update?.$inc, { receivableVersion: 1 });
});
