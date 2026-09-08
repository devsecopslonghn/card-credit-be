import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { sessionCookie, signSession } from "../src/auth.js";
import type { AuthRepository, AuthUser } from "../src/auth-repository.js";
import { ApiError } from "../src/errors.js";
import { MailDeliveryError, MailUnavailableError, type MailService } from "../src/mail-service.js";
import type { CardDto } from "@card-credit/contracts";
import { CardQueryService } from "../src/services/card-query-service.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import type { ComposedEmail } from "../src/statement-calendar-email.js";
import { registerTransactionRoutes } from "../src/transaction-routes.js";

const secret = "01234567890123456789012345678901";
const cardId = "507f1f77bcf86cd799439011";
const statementId = "507f191e810c19729de860ea";
const cookie = sessionCookie(signSession({ userId: "user-1", email: "stale@example.test", role: "user", workspaceId: "workspace-a" }, secret));
const authoritativeUser: AuthUser = { id: "user-1", email: "Owner@Example.test", passwordHash: "unused", role: "user", workspaceId: "workspace-a", displayName: "Owner", active: true, lockedAt: null };

const users = (user: AuthUser | null): AuthRepository => ({
  countUsers: async () => 0,
  findUserByEmail: async () => user,
  findUserById: async () => user,
  createUser: async (value) => ({ ...value, id: "created" }),
  upsertUser: async (value) => ({ ...value, id: "upserted" }),
  updatePassword: async () => {},
  touchLogin: async () => {},
  listUsers: async () => user ? [user] : [],
  updateUser: async () => user,
  createResetToken: async () => {},
  findResetToken: async () => null,
  consumeResetTokens: async () => {},
});

const installModels = (options: { card?: object | null; statement?: object | null } = {}) => {
  const card = options.card === undefined ? { _id: cardId, workspaceId: "workspace-a", displayName: "Platinum", providerName: "Bank", owner: "Tôi", cashbackCapAmount: null } : options.card;
  const statement = options.statement === undefined ? { _id: statementId, workspaceId: "workspace-a", userCardId: cardId, periodStartDate: "2026-07-01", periodEndDate: "2026-07-31", statementDate: "2026-07-31", paymentDueDate: "2026-08-15", paymentStatus: "OPEN" } : options.statement;
  const originalCardGet = CardQueryService.get;
  const originalStatementGet = StatementQueryService.get;
  CardQueryService.get = async () => {
    if (!card) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    return {
      id: cardId, presetId: null, providerCode: null, providerName: "Bank", displayName: "Platinum", network: null,
      legacy: true, owner: "Tôi", imageUrl: null, annualFee: null, targetSpendForWaiver: null, annualFeeWaiverTarget: null,
      statementDay: null, paymentDueDays: null, cashbackCapAmount: null, cashbackCapPeriod: null, active: true,
      reminderEnabled: true, reminderDaysBefore: [], reminderTimezone: "Asia/Ho_Chi_Minh", reminderTime: "08:00",
      statementDate: null, paymentDueDate: null, amountDueThisMonth: null, isPaidThisMonth: null, monthlyData: [],
    } satisfies CardDto;
  };
  StatementQueryService.get = async () => {
    if (!statement) throw new ApiError(404, "STATEMENT_NOT_FOUND", "Không tìm thấy kỳ sao kê.");
    return {
      id: statementId, cardId, periodStartDate: "2026-07-01", periodEndDate: "2026-07-31", statementDate: "2026-07-31",
      paymentDueDate: "2026-08-15", statementDaySnapshot: 31, paymentDueDaysSnapshot: 15, paymentStatus: "OPEN",
      effectivePaymentStatus: "OPEN", paidAt: null, paidAmount: null,
      summary: { statementAmount: 250_000, paymentAmount: 0, outstandingAmount: 250_000, personalSpending: 250_000, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 1 },
      transactions: [],
    };
  };
  return () => {
    CardQueryService.get = originalCardGet;
    StatementQueryService.get = originalStatementGet;
  };
};

const createApp = (repository: AuthRepository, mail: MailService) => {
  const app = buildApp({ isReady: () => true }, "silent");
  registerTransactionRoutes(app, secret, { users: repository, mail });
  return app;
};

test("calendar email route requires authentication before account or database access", async () => {
  let accountReads = 0;
  const repository = users(authoritativeUser);
  repository.findUserById = async () => { accountReads += 1; return authoritativeUser; };
  const app = createApp(repository, { sendStatementCalendarEmail: async () => {} });
  const response = await app.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/calendar-email` });
  assert.equal(response.statusCode, 401);
  assert.equal(accountReads, 0);
  await app.close();
});

test("calendar email uses normalized authoritative account email once and ignores browser overrides", async () => {
  const restore = installModels();
  const delivered: ComposedEmail[] = [];
  const repository = users(authoritativeUser);
  let accountReads = 0;
  repository.findUserById = async () => { accountReads += 1; return authoritativeUser; };
  const app = createApp(repository, { sendStatementCalendarEmail: async (email) => { delivered.push(email); } });
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/cards/${cardId}/statements/${statementId}/calendar-email?recipient=query@example.test&email=query2@example.test`,
      headers: { cookie },
      payload: { to: "body@example.test", email: "body2@example.test", SMTP_PASSWORD: "browser-secret" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { data: { sent: true, recipient: "o***@example.test" } });
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]!.to, "owner@example.test");
    assert.match(delivered[0]!.text, /250\.000/);
    assert.equal(accountReads, 1);
    assert.equal(JSON.stringify(response.json()).includes("browser-secret"), false);
  } finally {
    restore();
    await app.close();
  }
});

test("calendar email rejects stale browser identity before card, statement, or mail access", async () => {
  const originalCardGet = CardQueryService.get;
  const originalStatementGet = StatementQueryService.get;
  let cardReads = 0;
  let statementReads = 0;
  let mailCalls = 0;
  CardQueryService.get = async () => { cardReads += 1; throw new Error("card read must not run"); };
  StatementQueryService.get = async () => { statementReads += 1; throw new Error("statement read must not run"); };
  try {
    const staleUsers = [
      null,
      { ...authoritativeUser, active: false },
      { ...authoritativeUser, lockedAt: new Date() },
      { ...authoritativeUser, workspaceId: "workspace-b" },
    ];
    for (const stale of staleUsers) {
      const app = createApp(users(stale), { sendStatementCalendarEmail: async () => { mailCalls += 1; } });
      const response = await app.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/calendar-email`, headers: { cookie } });
      assert.equal(response.statusCode, 401);
      await app.close();
    }
    assert.equal(cardReads, 0);
    assert.equal(statementReads, 0);
    assert.equal(mailCalls, 0);
  } finally {
    CardQueryService.get = originalCardGet;
    StatementQueryService.get = originalStatementGet;
  }
});

test("calendar email returns safe errors for unusable account, inaccessible card and mismatched statement", async () => {
  const invalid = { ...authoritativeUser, email: "invalid" };
  const invalidApp = createApp(users(invalid), { sendStatementCalendarEmail: async () => assert.fail("must not send") });
  assert.equal((await invalidApp.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/calendar-email`, headers: { cookie } })).statusCode, 400);
  await invalidApp.close();

  for (const models of [{ card: null }, { statement: null }]) {
    const restore = installModels(models);
    const app = createApp(users(authoritativeUser), { sendStatementCalendarEmail: async () => assert.fail("must not send") });
    try {
      const response = await app.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/calendar-email`, headers: { cookie } });
      assert.equal(response.statusCode, 404);
    } finally { restore(); await app.close(); }
  }
});

test("calendar email maps unavailable and delivery failures without provider details", async () => {
  const restore = installModels();
  try {
    for (const [error, status] of [[new MailUnavailableError("contains smtp-password"), 503], [new MailDeliveryError("provider response secret"), 502]] as const) {
      const app = createApp(users(authoritativeUser), { sendStatementCalendarEmail: async () => { throw error; } });
      const response = await app.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/calendar-email`, headers: { cookie } });
      assert.equal(response.statusCode, status);
      assert.equal(response.body.includes(error.message), false);
      await app.close();
    }
  } finally { restore(); }
});
