import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceContext } from "../src/services/types/service-context.js";
import { CardQueryService } from "../src/services/card-query-service.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import { StatementCalendarEmailService } from "../src/services/statement-calendar-email-service.js";

const context: ServiceContext = { userId: "user-1", workspaceId: "workspace-a", role: "user", channel: "browser", correlationId: "calendar-email-test" };
const card = { id: "card-1", displayName: "Platinum", providerName: "Bank", owner: "Tôi", reminderTimezone: "Asia/Ho_Chi_Minh" };
const statement = { id: "statement-1", cardId: "card-1", periodStartDate: "2026-07-01", periodEndDate: "2026-07-31", statementDate: "2026-07-31", paymentDueDate: "2026-08-15", summary: { outstandingAmount: 250000 }, effectivePaymentStatus: "OPEN" };

test("statement calendar email service uses trusted card/statement reads and masks the recipient", async (t) => {
  const cardGet = t.mock.method(CardQueryService, "get", async (seenContext: ServiceContext, cardId: string) => { assert.equal(seenContext, context); assert.equal(cardId, "card-1"); return card as never; });
  const statementGet = t.mock.method(StatementQueryService, "get", async (seenContext: ServiceContext, cardId: string, statementId: string) => { assert.equal(seenContext, context); assert.equal(cardId, "card-1"); assert.equal(statementId, "statement-1"); return statement as never; });
  let sent: { to: string; text: string } | undefined;
  const result = await StatementCalendarEmailService.send(context, " Owner@Example.test ", "card-1", "statement-1", {
    sendStatementCalendarEmail: async (email) => { sent = email; },
  });
  assert.deepEqual(result, { sent: true, recipient: "o***@example.test" });
  assert.equal(sent?.to, "owner@example.test");
  assert.match(sent?.text ?? "", /250\.000/);
  assert.equal(cardGet.mock.callCount(), 1);
  assert.equal(statementGet.mock.callCount(), 1);
});

test("statement calendar email service rejects unusable actor email before downstream reads", async (t) => {
  const cardGet = t.mock.method(CardQueryService, "get", async () => { throw new Error("card read must not run"); });
  const statementGet = t.mock.method(StatementQueryService, "get", async () => { throw new Error("statement read must not run"); });
  await assert.rejects(() => StatementCalendarEmailService.send(context, "invalid", "card-1", "statement-1", { sendStatementCalendarEmail: async () => { throw new Error("mail must not run"); } }), (error) => (error as { code?: string }).code === "ACCOUNT_EMAIL_UNAVAILABLE");
  assert.equal(cardGet.mock.callCount(), 0);
  assert.equal(statementGet.mock.callCount(), 0);
});
