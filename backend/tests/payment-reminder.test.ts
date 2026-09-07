import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/errors.js";
import { normalizeReminderPreferences, validTimezone } from "../src/reminder-preferences.js";
import { composePaymentReminder, reminderDueDate, reminderIsDue, retryAt } from "../src/payment-reminder.js";
import { ReminderScheduler } from "../src/reminder-scheduler.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { ReminderDeliveryModel } from "../src/models/reminder-delivery.js";
import { WorkspaceModel } from "../src/models/workspace.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import type { AuthRepository, AuthUser } from "../src/auth-repository.js";
import type { ReminderEmail } from "../src/payment-reminder.js";

test("normalizes unique sorted offsets and validates preferences", () => {
  assert.deepEqual(normalizeReminderPreferences({ reminderEnabled: true, reminderDaysBefore: [1, 7, 3, 7], reminderTimezone: "Asia/Ho_Chi_Minh", reminderTime: "08:00" }), { reminderEnabled: true, reminderDaysBefore: [7, 3, 1], reminderTimezone: "Asia/Ho_Chi_Minh", reminderTime: "08:00" });
  assert.equal(validTimezone("Asia/Ho_Chi_Minh"), true);
  for (const input of [{ reminderDaysBefore: [-1] }, { reminderDaysBefore: [61] }, { reminderTime: "8:00" }, { reminderTimezone: "Mars/Hanoi" }]) assert.throws(() => normalizeReminderPreferences(input), ApiError);
});

test("uses card local date and send time for due offset", () => {
  assert.equal(reminderDueDate(new Date("2026-07-12T01:00:00Z"), 7, "Asia/Ho_Chi_Minh"), "2026-07-19");
  assert.equal(reminderIsDue(new Date("2026-07-12T01:00:00Z"), "2026-07-19", 7, "Asia/Ho_Chi_Minh", "08:00"), true);
  assert.equal(reminderIsDue(new Date("2026-07-12T00:59:00Z"), "2026-07-19", 7, "Asia/Ho_Chi_Minh", "08:00"), false);
  assert.equal(reminderIsDue(new Date("2026-07-12T01:00:00Z"), "2026-07-19", 3, "Asia/Ho_Chi_Minh", "08:00"), false);
});

test("retry backoff is bounded and reminder is Vietnamese without sensitive persistence", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(retryAt(now, 1).toISOString(), "2026-01-01T00:01:00.000Z");
  assert.equal(retryAt(now, 3).toISOString(), "2026-01-01T00:30:00.000Z");
  assert.match(composePaymentReminder({ to: "user@example.com", cardName: "Visa", statementDate: "2026-01-01", dueDate: "2026-01-08", amount: 100000, daysBefore: 7 }).text, /kiểm tra trạng thái hiện tại/);
});

test("scheduler scans exact due dates and uses canonical statement amounts", async (t) => {
  const userId = "507f1f77bcf86cd799439041";
  const cardA = "507f1f77bcf86cd799439011";
  const cardB = "507f1f77bcf86cd799439012";
  const statementA = "507f1f77bcf86cd799439021";
  const statementB = "507f1f77bcf86cd799439022";
  t.mock.method(CreditCardModel, "find", async () => [
    { toObject: () => ({ _id: cardA, workspaceId: "workspace-a", userId, displayName: "Card A", reminderDaysBefore: [7, 3], reminderTimezone: "Asia/Ho_Chi_Minh", reminderTime: "08:00" }) },
    { toObject: () => ({ _id: cardB, workspaceId: "workspace-a", userId: null, displayName: "Card B", reminderDaysBefore: [7], reminderTimezone: "Asia/Ho_Chi_Minh", reminderTime: "08:00" }) },
  ] as never);
  const workspaceFind = t.mock.method(WorkspaceModel, "find", async () => [{
    get: (field: string) => field === "workspaceId" ? "workspace-a" : userId,
  }] as never);
  const statementList = t.mock.method(StatementQueryService, "listForCardIds", async () => [
    { id: statementA, cardId: cardA, periodStartDate: "2026-06-06", periodEndDate: "2026-07-05", statementDate: "2026-07-05", paymentDueDate: "2026-07-19", statementDaySnapshot: 5, paymentDueDaysSnapshot: 14, paymentStatus: "OPEN", effectivePaymentStatus: "OPEN", paidAt: null, paidAmount: null, summary: { statementAmount: 150_000, paymentAmount: 50_000, outstandingAmount: 100_000, personalSpending: 150_000, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 1 } },
    { id: statementB, cardId: cardB, periodStartDate: "2026-06-06", periodEndDate: "2026-07-05", statementDate: "2026-07-05", paymentDueDate: "2026-07-19", statementDaySnapshot: 5, paymentDueDaysSnapshot: 14, paymentStatus: "OPEN", effectivePaymentStatus: "OPEN", paidAt: null, paidAmount: null, summary: { statementAmount: 200_000, paymentAmount: 0, outstandingAmount: 200_000, personalSpending: 200_000, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 1 } },
  ] as never);
  const claim = t.mock.method(ReminderDeliveryModel, "findOneAndUpdate", async () => ({
    _id: `delivery-${claim.mock.callCount()}`,
    get: (field: string) => field === "attemptCount" ? 1 : undefined,
  }) as never);
  const deliveryUpdate = t.mock.method(ReminderDeliveryModel, "updateOne", async () => ({ modifiedCount: 1 }) as never);
  const user: AuthUser = { id: userId, email: "user@example.test", passwordHash: "hash", role: "user", workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };
  let userReads = 0;
  const users = { findUserById: async () => { userReads += 1; return user; } } as unknown as AuthRepository;
  const messages: ReminderEmail[] = [];
  const scheduler = new ReminderScheduler(
    users,
    { sendStatementCalendarEmail: async () => {}, sendPaymentReminder: async (message) => { messages.push(message); } },
    60_000,
    300_000,
    { error: () => {}, info: () => {} },
    () => new Date("2026-07-12T01:00:00Z"),
  );

  await scheduler.scan();

  assert.equal(statementList.mock.callCount(), 1);
  assert.equal((statementList.mock.calls[0]?.arguments[0] as { workspaceId?: string } | undefined)?.workspaceId, "workspace-a");
  assert.deepEqual(statementList.mock.calls[0]?.arguments[1], [cardA, cardB]);
  assert.deepEqual(statementList.mock.calls[0]?.arguments[2], { unpaidOnly: true, paymentDueDates: ["2026-07-19", "2026-07-15"], order: "paymentDueDate" });
  assert.equal(workspaceFind.mock.callCount(), 1);
  assert.deepEqual(workspaceFind.mock.calls[0]?.arguments[0], {
    workspaceId: { $in: ["workspace-a"] },
  });
  assert.equal(userReads, 1);
  assert.equal(claim.mock.callCount(), 2);
  assert.equal(deliveryUpdate.mock.callCount(), 2);
  assert.deepEqual(messages.map((message) => message.text.includes("200.000")), [false, true]);
  assert.equal(messages[0]?.text.includes("100.000"), true);
});
