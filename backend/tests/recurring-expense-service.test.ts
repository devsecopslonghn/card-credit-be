import assert from "node:assert/strict";
import test from "node:test";
import { AccountModel } from "../src/models/account.js";
import { RecurringExpenseModel } from "../src/models/recurring-expense.js";
import { RecurringExpenseService } from "../src/services/recurring-expense-service.js";

const accountId = "507f1f77bcf86cd799439011";
const recurringId = "507f1f77bcf86cd799439012";
const context = { userId: "user-a", workspaceId: "workspace-a", role: "user", channel: "browser", correlationId: "test" } as const;
const input = { name: "  Internet  ", categoryId: "HOME", accountId, expectedAmount: 250_000, frequency: "MONTHLY" as const, nextDueDate: "2026-09-05" };
const record = { _id: recurringId, ...input, name: "Internet", active: true };
const query = <T>(value: T) => ({ lean: async () => value });

test("recurring expense list is workspace-scoped, active-only and bounded", async (t) => {
  let observedLimit = 0;
  t.mock.method(RecurringExpenseModel, "find", () => ({
    sort() { return this; },
    limit(value: number) { observedLimit = value; return this; },
    lean: async () => [record],
  }) as never);
  const result = await RecurringExpenseService.list(context, 500);
  assert.equal(observedLimit, 100);
  assert.deepEqual(result, [{ id: recurringId, name: "Internet", categoryId: "HOME", accountId, expectedAmount: 250_000, frequency: "MONTHLY", nextDueDate: "2026-09-05", active: true }]);
});

test("recurring expense create normalizes input and validates account scope", async (t) => {
  t.mock.method(AccountModel, "exists", async () => ({ _id: accountId }) as never);
  let observed: Record<string, unknown> | undefined;
  t.mock.method(RecurringExpenseModel, "create", async (value: Record<string, unknown>) => { observed = value; return { ...value, _id: recurringId }; });
  const result = await RecurringExpenseService.create(context, input);
  assert.equal(observed?.name, "Internet");
  assert.equal(observed?.workspaceId, "workspace-a");
  assert.deepEqual(result, { id: recurringId, name: "Internet", categoryId: "HOME", accountId, expectedAmount: 250_000, frequency: "MONTHLY", nextDueDate: "2026-09-05", active: true });
});

test("recurring expense update and deactivate stay inside the workspace", async (t) => {
  t.mock.method(AccountModel, "exists", async () => ({ _id: accountId }) as never);
  t.mock.method(RecurringExpenseModel, "findOneAndUpdate", () => query(record) as never);
  const updated = await RecurringExpenseService.update(context, recurringId, input);
  const deactivated = await RecurringExpenseService.deactivate(context, recurringId);
  assert.equal(updated.active, true);
  assert.equal(deactivated.id, recurringId);
});

test("recurring expense rejects invalid calendar dates before persistence", async () => {
  await assert.rejects(() => RecurringExpenseService.create(context, { ...input, nextDueDate: "2026-02-30" }), /Khoản định kỳ không hợp lệ/);
});
