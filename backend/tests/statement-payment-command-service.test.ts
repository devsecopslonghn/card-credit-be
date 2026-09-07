import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import { registerTransactionRoutes } from "../src/transaction-routes.js";
import { registerFinancialTransactionRoutes } from "../src/financial-transaction-routes.js";
import { StatementPaymentCommandService, nextPaymentState, paidLedgerIsConsistent, paymentCommandPayloadHash, paymentTotals } from "../src/services/statement-payment-command-service.js";
import { FinancialTransactionService } from "../src/services/financial-transaction-service.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { commandGuardService, type CommandGuardSpec } from "../src/services/command-guard-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const secret = "01234567890123456789012345678901";
const cardId = "507f1f77bcf86cd799439011";
const statementId = "507f1f77bcf86cd799439021";
const user = { id: "user-a", email: "user@example.test", passwordHash: "", role: "user" as const, workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null };
const cookie = sessionCookie(signSession({ userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId }, secret));
const browserPreviewInvocation = { previewId: "preview-test", confirmationTokenHash: "b".repeat(64), previewPayloadHash: "c".repeat(64) };

test("payment totals use persisted credit impact rather than raw amount", () => {
  assert.deepEqual(paymentTotals([
    { transactionType: "EXPENSE", amount: 1_000, creditDebt: 1_000 },
    { transactionType: "REFUND", amount: 100, creditDebt: -100 },
    { transactionType: "STATEMENT_PAYMENT", amount: 300, creditDebt: -300 },
  ]), { statementAmount: 1_000, paymentAmount: 400, outstandingAmount: 600 });
});

test("paid ledger consistency supports zero-payment statements and rejects partial paid state", () => {
  assert.equal(paidLedgerIsConsistent({ paidAmount: 0 }, []), true);
  assert.equal(paidLedgerIsConsistent({ paidAmount: 500 }, [{ transactionType: "STATEMENT_PAYMENT", amount: 400, creditDebt: -400 }]), false);
  assert.equal(paidLedgerIsConsistent({ paidAmount: 400 }, [{ transactionType: "STATEMENT_PAYMENT", amount: 400, creditDebt: -400 }]), true);
});

test("financial transaction model allows a replacement after a payment is voided", () => {
  const indexes = FinancialTransactionModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; [key: string]: unknown }]>;
  const index = indexes.find(([, options]) => options.name === "statement_payment_unique");
  assert.deepEqual(index, [
    { workspaceId: 1, statementId: 1, transactionType: 1 },
    {
      name: "statement_payment_unique",
      unique: true,
      partialFilterExpression: { transactionType: "STATEMENT_PAYMENT", statementId: { $type: "objectId" }, voidedAt: null },
    },
  ]);
});

test("financial transaction model indexes receivable status and reimbursement linkage", () => {
  const indexes = FinancialTransactionModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; [key: string]: unknown }] >;
  assert.ok(indexes.some(([, options]) => options.name === "receivable_status_lookup"));
  assert.ok(indexes.some(([, options]) => options.name === "reimbursement_source_lookup"));
});

test("payment state transitions keep PAID locked and reopen only a closed statement", () => {
  assert.equal(nextPaymentState("OPEN", "CLOSED"), "STATEMENT_CLOSED");
  assert.equal(nextPaymentState("STATEMENT_CLOSED", "REOPEN"), "OPEN");
  assert.equal(nextPaymentState("OVERDUE", "CLOSED"), "STATEMENT_CLOSED");
  assert.equal(nextPaymentState("OPEN", "PAID"), "PAID");
  assert.throws(() => nextPaymentState("PAID", "CLOSED"), (error: unknown) => error instanceof Error && "code" in error && error.code === "STATEMENT_PAID_LOCKED");
  assert.throws(() => nextPaymentState("PAID", "REOPEN"), (error: unknown) => error instanceof Error && "code" in error && error.code === "STATEMENT_PAID_LOCKED" && error.message.includes("lý do"));
});

test("canonical payment service rejects invalid runtime actions before database access", async () => {
  await assert.rejects(
    StatementPaymentCommandService.execute(
      { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "browser", correlationId: "payment-test" },
      cardId,
      statementId,
      { action: "UNKNOWN" } as never,
      { idempotencyKey: "payment-invalid-1", endpointOrTool: "test.payment" },
    ),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PAYMENT_ACTION",
  );
  assert.throws(() => nextPaymentState("OPEN", "UNKNOWN" as never), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PAYMENT_ACTION");
});

test("payment preview reads the ledger without writing and flags missing repayment account", async (t) => {
  const statement = { _id: statementId, userCardId: cardId, workspaceId: user.workspaceId, paymentStatus: "OPEN", updatedAt: new Date("2026-08-16T00:00:00.000Z") };
  const transactions = [{ transactionType: "EXPENSE", amount: 1_000, creditDebt: 1_000 }];
  t.mock.method(CardStatementModel, "findOne", () => ({ lean: async () => statement }) as never);
  t.mock.method(FinancialTransactionModel, "find", () => ({ lean: async () => transactions }) as never);
  const preview = await StatementPaymentCommandService.preview(
    { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "browser", correlationId: "payment-preview-test" },
    cardId,
    statementId,
    { action: "PAID" },
  );
  assert.deepEqual(preview, {
    operation: "pay_statement",
    cardId,
    statementId,
    action: "PAID",
    paymentStatus: "OPEN",
    nextPaymentStatus: "PAID",
    statementAmount: 1_000,
    paymentAmount: 0,
    outstandingAmount: 1_000,
    amountToPay: 1_000,
    repaymentAccountId: null,
    version: "2026-08-16T00:00:00.000Z",
    requiresRepaymentAccount: true,
    warnings: ["REPAYMENT_ACCOUNT_REQUIRED"],
  });
});

test("payment execute rejects a stale preview version before ledger work", async (t) => {
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: CommandGuardSpec, work: (session: never) => Promise<unknown>) => work({} as never));
  t.mock.method(CardStatementModel, "findOne", () => ({ session: () => ({ lean: async () => ({ _id: statementId, userCardId: cardId, workspaceId: user.workspaceId, paymentStatus: "OPEN", updatedAt: new Date("2026-08-16T00:00:00.000Z") }) }) }) as never);
  await assert.rejects(
    StatementPaymentCommandService.execute(
      { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "browser", correlationId: "payment-stale-test" },
      cardId,
      statementId,
      { action: "PAID", expectedVersion: "2026-08-15T00:00:00.000Z" },
      { idempotencyKey: "payment-stale-1", endpointOrTool: "test.payment", ...browserPreviewInvocation },
    ),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PAYMENT_PREVIEW_STALE",
  );
});

test("REOPEN correction voids an erroneous statement payment and reopens atomically", async (t) => {
  const payment = { _id: "507f1f77bcf86cd799439099", accountId: "507f1f77bcf86cd799439031", statementId, transactionType: "STATEMENT_PAYMENT", amount: 16_193_000, creditDebt: -16_193_000 };
  let voidUpdate: Record<string, unknown> | undefined;
  let statementUpdate: Record<string, unknown> | undefined;
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: CommandGuardSpec, work: (session: never) => Promise<unknown>) => work({} as never));
  t.mock.method(CardStatementModel, "findOne", () => ({ session: () => ({ lean: async () => ({ _id: statementId, userCardId: cardId, workspaceId: user.workspaceId, paymentStatus: "PAID", paidAmount: 16_193_000, updatedAt: new Date("2026-08-16T00:00:00.000Z") }) }) }) as never);
  t.mock.method(FinancialTransactionModel, "find", () => ({ session: () => ({ lean: async () => [payment] }) }) as never);
  t.mock.method(FinancialTransactionModel, "updateMany", async (_filter: Record<string, unknown>, update: Record<string, unknown>) => { voidUpdate = update; return { modifiedCount: 1 } as never; });
  t.mock.method(CardStatementModel, "findOneAndUpdate", (_filter: Record<string, unknown>, update: Record<string, unknown>) => { statementUpdate = update; return { lean: async () => ({ _id: statementId, paymentStatus: "OPEN", paidAmount: null, paidAt: null }) } as never; });
  const reason = "Correction: reimbursement was incorrectly treated as statement payment";
  const correctionDate = new Date("2026-08-20T00:00:00.000Z");
  const result = await StatementPaymentCommandService.execute(
    { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "browser", correlationId: "payment-correction-test" },
    cardId,
    statementId,
    { action: "REOPEN", reason, reverseErroneousPayment: true, expectedVersion: "2026-08-16T00:00:00.000Z" },
    { idempotencyKey: "payment-correction-1", endpointOrTool: "confirm_pay_statement", ...browserPreviewInvocation }, correctionDate,
  );
  assert.equal(result.paymentStatus, "OPEN");
  assert.deepEqual(voidUpdate, { $set: { voidedAt: correctionDate, voidReason: reason } });
  assert.deepEqual(statementUpdate, { $set: { paymentStatus: "OPEN", paidAt: null, paidAmount: null } });
});

test("payment command binds statement identity and safe result metadata to the generic guard", async (t) => {
  let observed: CommandGuardSpec | undefined;
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, spec: CommandGuardSpec) => {
    observed = spec;
    return { statementId, action: "CLOSED", paymentStatus: "STATEMENT_CLOSED", paidAt: null, paidAmount: 0 };
  });
  const input = { action: "CLOSED" as const };
  const result = await StatementPaymentCommandService.execute(
    { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "browser", correlationId: "payment-guard-test" },
    cardId,
    statementId,
    input,
    { idempotencyKey: "payment-command-1", endpointOrTool: "PATCH /api/cards/:id/statements/:statementId/payment", ...browserPreviewInvocation },
  );
  assert.deepEqual(result, { statementId, action: "CLOSED", paymentStatus: "STATEMENT_CLOSED", paidAt: null, paidAmount: 0 });
  assert.equal(observed?.operation, "pay_statement");
  assert.deepEqual(observed?.resource, { type: "statement", cardId, statementId });
  assert.equal(observed?.payloadHash, paymentCommandPayloadHash(cardId, statementId, input));
});

test("payment retry keeps the idempotency hash stable when only the preview version changes", async (t) => {
  const observed: CommandGuardSpec[] = [];
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, spec: CommandGuardSpec) => {
    observed.push(spec);
    return { statementId, action: "PAID", paymentStatus: "PAID", paidAt: null, paidAmount: 100 };
  });
  const context = { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "browser" as const, correlationId: "payment-retry-hash" };
  await StatementPaymentCommandService.execute(context, cardId, statementId, { action: "PAID", repaymentAccountId: "507f1f77bcf86cd799439031", expectedVersion: "2026-08-16T00:00:00.000Z" }, { idempotencyKey: "payment-retry-hash-1", endpointOrTool: "test.payment", ...browserPreviewInvocation });
  await StatementPaymentCommandService.execute(context, cardId, statementId, { action: "PAID", repaymentAccountId: "507f1f77bcf86cd799439031", expectedVersion: "2026-08-16T00:01:00.000Z" }, { idempotencyKey: "payment-retry-hash-1", endpointOrTool: "test.payment", ...browserPreviewInvocation });
  assert.equal(observed[0]?.payloadHash, observed[1]?.payloadHash);
  assert.notEqual(observed[0]?.payloadHash, paymentCommandPayloadHash(cardId, statementId, { action: "CLOSED" }));
});

test("generic transaction preview rejects statement payment instead of advertising an executable command", async () => {
  await assert.rejects(
    FinancialTransactionService.preview(
      { userId: user.id, workspaceId: user.workspaceId, role: user.role, channel: "mcp", correlationId: "preview-test" },
      { items: [{ accountId: cardId, statementId, transactionDate: "2026-08-16", amount: 100, transactionType: "STATEMENT_PAYMENT" }] } as never,
    ),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "STATEMENT_PAYMENT_COMMAND_REQUIRED",
  );
});

test("payment REST adapter rejects missing/unknown action and delegates canonical payload", async (t) => {
  const observed: Array<{ context: ServiceContext; cardId: string; statementId: string; input: unknown; invocation: unknown }> = [];
  t.mock.method(StatementPaymentCommandService, "execute", async (context: ServiceContext, requestedCardId: string, requestedStatementId: string, input: unknown, invocation: unknown) => {
    observed.push({ context, cardId: requestedCardId, statementId: requestedStatementId, input, invocation });
    return { _id: statementId, userCardId: cardId };
  });
  t.mock.method(StatementPaymentCommandService, "preview", async () => ({
    operation: "pay_statement", cardId, statementId, action: "PAID", paymentStatus: "OPEN", nextPaymentStatus: "PAID",
    statementAmount: 1_000, paymentAmount: 0, outstandingAmount: 1_000, amountToPay: 1_000,
    repaymentAccountId: "507f1f77bcf86cd799439031", version: "2026-08-16T00:00:00.000Z", requiresRepaymentAccount: false, warnings: [],
  }));
  t.mock.method(StatementQueryService, "get", async () => ({
    id: statementId, cardId, periodStartDate: "2026-07-12", periodEndDate: "2026-08-11", statementDate: "2026-08-11", paymentDueDate: "2026-08-26", statementDaySnapshot: 11, paymentDueDaysSnapshot: 15,
    paymentStatus: "PAID", effectivePaymentStatus: "PAID", paidAt: "2026-08-16T00:00:00.000Z", paidAmount: 600,
    summary: { statementAmount: 1_000, paymentAmount: 600, outstandingAmount: 400, personalSpending: 1_000, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 1 },
  }));
  const app = buildApp({ isReady: () => true }, "silent");
  const previewService = { issue: async (context: ServiceContext, operation: string, payload: unknown, codec: { issue: (operation: string, payload: unknown, binding: { workspaceId: string; userId: string; channel: string }) => unknown }) => codec.issue(operation, payload, { workspaceId: context.workspaceId, userId: context.userId, channel: context.channel }) } as never;
  registerTransactionRoutes(app, secret, undefined, previewService);
  registerFinancialTransactionRoutes(app, secret);
  for (const payload of [{}, { action: "UNKNOWN" }, { action: "PAID", unexpected: true }]) {
    const response = await app.inject({ method: "PATCH", url: `/api/cards/${cardId}/statements/${statementId}/payment`, headers: { cookie }, payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_PAYMENT_ACTION");
  }
  const previewResponse = await app.inject({ method: "POST", url: `/api/cards/${cardId}/statements/${statementId}/payment/preview`, headers: { cookie }, payload: { action: "PAID", repaymentAccountId: "507f1f77bcf86cd799439031" } });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);
  const preview = previewResponse.json().data;
  const missingKey = await app.inject({ method: "PATCH", url: `/api/cards/${cardId}/statements/${statementId}/payment`, headers: { cookie }, payload: { action: "PAID", repaymentAccountId: "507f1f77bcf86cd799439031", expectedVersion: preview.version, previewId: preview.previewId, confirmationToken: preview.confirmationToken } });
  assert.equal(missingKey.statusCode, 400);
  assert.equal(missingKey.json().error.code, "IDEMPOTENCY_KEY_REQUIRED");
  const response = await app.inject({ method: "PATCH", url: `/api/cards/${cardId}/statements/${statementId}/payment`, headers: { cookie, "idempotency-key": " payment-command-1 " }, payload: { action: "PAID", repaymentAccountId: "507f1f77bcf86cd799439031", expectedVersion: preview.version, previewId: preview.previewId, confirmationToken: preview.confirmationToken } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.id, statementId);
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0]?.input, { action: "PAID", repaymentAccountId: "507f1f77bcf86cd799439031", expectedVersion: preview.version });
  assert.equal((observed[0]?.invocation as { idempotencyKey: string }).idempotencyKey, "payment-command-1");
  assert.equal(typeof (observed[0]?.invocation as { previewId: string }).previewId, "string");
  assert.equal(typeof (observed[0]?.invocation as { confirmationTokenHash: string }).confirmationTokenHash, "string");
  assert.equal(observed[0]?.context.workspaceId, user.workspaceId);

  assert.equal(preview.operation, "pay_statement");

  const genericPayment = await app.inject({
    method: "POST",
    url: "/api/financial-transactions",
    headers: { cookie, "idempotency-key": "statement-generic-1" },
    payload: { accountId: cardId, statementId, transactionDate: "2026-08-16", amount: 100, transactionType: "STATEMENT_PAYMENT" },
  });
  assert.equal(genericPayment.statusCode, 409);
  assert.equal(genericPayment.json().error.code, "STATEMENT_PAYMENT_COMMAND_REQUIRED");
  await app.close();
});
