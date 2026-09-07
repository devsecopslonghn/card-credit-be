import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import { registerNotificationRoutes } from "../src/notification-routes.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";

const secret = "01234567890123456789012345678901";
const cookie = sessionCookie(signSession({ userId: "user-1", email: "user@example.test", role: "user", workspaceId: "workspace-a" }, secret));
const cardId = "507f1f77bcf86cd799439011";
const orphanCardId = "507f1f77bcf86cd799439012";
const statementIds = ["507f1f77bcf86cd799439021", "507f1f77bcf86cd799439022", "507f1f77bcf86cd799439023"];

const chain = <T>(value: T) => {
  const query = {
    sort: () => query,
    limit: () => query,
    lean: async () => value,
  };
  return query;
};

test("notifications use canonical statement status, preserve paid/orphan rows and batch transactions", async (t) => {
  const statements = [
    { _id: statementIds[0], workspaceId: "workspace-a", userCardId: cardId, periodStartDate: "2099-06-01", periodEndDate: "2099-06-30", statementDate: "2099-06-30", paymentDueDate: "2099-07-15", statementDaySnapshot: 30, paymentDueDaysSnapshot: 15, paymentStatus: "PAID" },
    { _id: statementIds[1], workspaceId: "workspace-a", userCardId: cardId, periodStartDate: "2020-06-01", periodEndDate: "2020-06-30", statementDate: "2020-06-30", paymentDueDate: "2020-07-15", statementDaySnapshot: 30, paymentDueDaysSnapshot: 15, paymentStatus: "OPEN" },
    { _id: statementIds[2], workspaceId: "workspace-a", userCardId: orphanCardId, periodStartDate: "2099-08-01", periodEndDate: "2099-08-31", statementDate: "2099-08-31", paymentDueDate: "2099-09-15", statementDaySnapshot: 31, paymentDueDaysSnapshot: 15, paymentStatus: "OPEN" },
  ];
  const transactions = statementIds.map((statementId, index) => ({ _id: `507f1f77bcf86cd79943903${index + 1}`, statementId, accountId: cardId, accountType: "CREDIT", transactionType: "EXPENSE", ownership: "PERSONAL", categoryId: "OTHER", amount: 100 + index, creditDebt: 100 + index, personalSpending: 100 + index, debitCashflow: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionDate: "2099-06-01", note: "" }));
  const statementFind = t.mock.method(CardStatementModel, "find", () => chain(statements) as never);
  const transactionFind = t.mock.method(FinancialTransactionModel, "find", () => chain(transactions) as never);
  const cardFind = t.mock.method(CreditCardModel, "find", () => chain([{ _id: cardId, workspaceId: "workspace-a", providerName: "Bank A", displayName: "Card A" }]) as never);
  const app = buildApp({ isReady: () => true }, "silent");
  registerNotificationRoutes(app, secret);

  const response = await app.inject({ url: "/api/notifications?limit=200", headers: { cookie } });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.meta.limit, 100);
  assert.deepEqual(body.data.map((item: { status: string }) => item.status), ["success", "alert", "warning"]);
  assert.equal(body.data[0].message, "Bank A · Card A");
  assert.equal(body.data[2].message, "Thẻ tín dụng");
  assert.deepEqual(Object.keys(body.data[0]).sort(), ["cardId", "dueDate", "id", "message", "paymentStatus", "status", "title", "type"]);
  assert.equal(statementFind.mock.callCount(), 1);
  assert.equal(transactionFind.mock.callCount(), 1);
  assert.equal(cardFind.mock.callCount(), 1);
  assert.deepEqual(statementFind.mock.calls[0]?.arguments[0], { workspaceId: "workspace-a" });
  assert.deepEqual(transactionFind.mock.calls[0]?.arguments[0], { statementId: { $in: statementIds }, workspaceId: "workspace-a" });
  await app.close();
});

test("notifications reject unauthenticated requests before reads", async () => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerNotificationRoutes(app, secret);
  assert.equal((await app.inject({ url: "/api/notifications" })).statusCode, 401);
  await app.close();
});
