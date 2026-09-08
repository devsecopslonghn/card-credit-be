import assert from "node:assert/strict";
import test from "node:test";
import { planLegacyStatementPaymentRepairs, reconciliationPlanHash } from "../src/finance-reconciliation.js";
import { FinancialReconciliationCaseModel } from "../src/models/financial-reconciliation-case.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { AccountModel } from "../src/models/account.js";
import { commandGuardService, type CommandGuardSpec } from "../src/services/command-guard-service.js";
import { markLegacyStatementPaymentPaid } from "../src/services/legacy-payment-reconciliation-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const account = { _id: "507f1f77bcf86cd799439011", type: "DEBIT", active: true };
const statement = { _id: "507f1f77bcf86cd799439021", paymentStatus: "STATEMENT_CLOSED", paidAmount: null, paidAt: null };
const payment = { _id: "507f1f77bcf86cd799439031", statementId: "507f1f77bcf86cd799439021", transactionType: "STATEMENT_PAYMENT", amount: 1000, creditDebt: -1000, debitCashflow: -1000, personalSpending: 0, accountId: "507f1f77bcf86cd799439011", accountType: "DEBIT", ownership: "PERSONAL", createdAt: "2026-08-15T10:00:00.000Z", transactionDate: "2026-08-15" };

test("legacy payment planner repairs only a fully settled non-PAID statement", () => {
  const plan = planLegacyStatementPaymentRepairs([
    statement,
  ], [
    { ...payment },
    { _id: "507f1f77bcf86cd799439041", statementId: "507f1f77bcf86cd799439021", transactionType: "EXPENSE", amount: 1000, creditDebt: 1000, accountId: "507f1f77bcf86cd799439051" },
  ], [account]);
  assert.equal(plan.repairs.length, 1);
  assert.match(plan.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.repairs[0], {
    statementId: "507f1f77bcf86cd799439021",
    transactionId: "507f1f77bcf86cd799439031",
    accountId: "507f1f77bcf86cd799439011",
    amount: 1000,
    previousStatus: "STATEMENT_CLOSED",
    paidAt: new Date("2026-08-15T10:00:00.000Z"),
  });
  assert.equal(plan.skipped.length, 0);
});

test("legacy payment planner skips ambiguous, partial, paid and unsafe records", () => {
  const statements = [
    { _id: "507f1f77bcf86cd799439061", paymentStatus: "OPEN", paidAmount: null, paidAt: null },
    { _id: "507f1f77bcf86cd799439062", paymentStatus: "OPEN", paidAmount: null, paidAt: null },
    { _id: "507f1f77bcf86cd799439063", paymentStatus: "PAID", paidAmount: 1000, paidAt: "2026-08-15T10:00:00.000Z" },
    { _id: "507f1f77bcf86cd799439064", paymentStatus: "OPEN", paidAmount: null, paidAt: null },
    { _id: "507f1f77bcf86cd799439065", paymentStatus: "OVERDUE", paidAmount: null, paidAt: null },
  ];
  const transactions = [
    { ...payment, _id: "507f1f77bcf86cd799439071", statementId: "507f1f77bcf86cd799439061", amount: 900, creditDebt: -900, debitCashflow: -900 },
    { ...payment, _id: "507f1f77bcf86cd799439072", statementId: "507f1f77bcf86cd799439062" },
    { ...payment, _id: "507f1f77bcf86cd799439073", statementId: "507f1f77bcf86cd799439062" },
    { ...payment, _id: "507f1f77bcf86cd799439074", statementId: "507f1f77bcf86cd799439063" },
    { ...payment, _id: "507f1f77bcf86cd799439075", statementId: "507f1f77bcf86cd799439064", accountId: "507f1f77bcf86cd799439099" },
    { ...payment, _id: "507f1f77bcf86cd799439076", statementId: "507f1f77bcf86cd799439065" },
  ];
  const plan = planLegacyStatementPaymentRepairs(statements, transactions, [account]);
  assert.equal(plan.repairs.length, 0);
  assert.deepEqual(plan.skipped.map((item) => item.reason).sort(), [
    "LEDGER_IMPACT_DOES_NOT_FULLY_SETTLE_STATEMENT",
    "MULTIPLE_STATEMENT_PAYMENTS",
    "PAYMENT_ACCOUNT_NOT_ACTIVE_REAL_MONEY",
    "STATEMENT_STATUS_UNSUPPORTED",
  ]);
});

test("legacy payment planner fails closed for malformed IDs and detects source drift", () => {
  const malformed = planLegacyStatementPaymentRepairs(
    [{ _id: "bad-statement", paymentStatus: "OPEN", paidAmount: null, paidAt: null }],
    [{ ...payment, _id: "bad-payment", statementId: "bad-statement" }],
    [account],
  );
  assert.equal(malformed.repairs.length, 0);
  assert.equal(malformed.skipped[0]?.reason, "STATEMENT_ID_INVALID");
  const changed = planLegacyStatementPaymentRepairs([
    statement,
  ], [
    { ...payment },
    { _id: "507f1f77bcf86cd799439041", statementId: "507f1f77bcf86cd799439021", transactionType: "EXPENSE", amount: 900, creditDebt: 900, accountId: "507f1f77bcf86cd799439051" },
  ], [account]);
  assert.notEqual(changed.sourceHash, planLegacyStatementPaymentRepairs([
    statement,
  ], [
    { ...payment },
    { _id: "507f1f77bcf86cd799439041", statementId: "507f1f77bcf86cd799439021", transactionType: "EXPENSE", amount: 1000, creditDebt: 1000, accountId: "507f1f77bcf86cd799439051" },
  ], [account]).sourceHash);
});

test("reconciliation cases are additive and idempotent by workspace and transaction", () => {
  const indexes = FinancialReconciliationCaseModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; unique?: boolean }] >;
  const unique = indexes.find(([, options]) => options.name === "reconciliation_case_unique");
  assert.equal(unique?.[1].unique, true);
  assert.equal(indexes.some(([, options]) => options.name === "reconciliation_case_workspace_status"), true);
});

test("mark-paid is job-only and binds reviewed case data to the generic command guard", async (t) => {
  const observed: { context?: ServiceContext; spec?: CommandGuardSpec } = {};
  t.mock.method(commandGuardService, "execute", async (context: ServiceContext, spec: CommandGuardSpec) => {
    observed.context = context;
    observed.spec = spec;
    return { status: "APPLIED", caseId: "507f1f77bcf86cd799439099", statementId: "507f1f77bcf86cd799439021", transactionId: "507f1f77bcf86cd799439031", paymentStatus: "PAID", paidAmount: 1000, paidAt: "2026-08-15T10:00:00.000Z" } as never;
  });
  const context = { workspaceId: "workspace-a", userId: "operator-a", role: "admin" as const, channel: "job" as const, correlationId: "reconcile-correlation" };
  const result = await markLegacyStatementPaymentPaid(context, {
    caseId: "507f1f77bcf86cd799439099",
    sourceHash: "a".repeat(64),
    planHash: "b".repeat(64),
    currentSourceHash: "a".repeat(64),
    currentPlanHash: "b".repeat(64),
    expectedStatus: "STATEMENT_CLOSED",
    idempotencyKey: "mark-paid-key-1",
  });
  assert.equal(result.status, "APPLIED");
  assert.equal(observed.context?.channel, "job");
  assert.equal(observed.spec?.operation, "mark_legacy_statement_payment_paid");
  assert.equal(observed.spec?.idempotencyKey, "mark-paid-key-1");
  assert.deepEqual(observed.spec?.resource, { type: "reconciliation_case", id: "507f1f77bcf86cd799439099" });
  await assert.rejects(
    markLegacyStatementPaymentPaid({ ...context, channel: "browser" }, {
      caseId: "507f1f77bcf86cd799439099",
      sourceHash: "a".repeat(64),
      planHash: "b".repeat(64),
      currentSourceHash: "a".repeat(64),
      currentPlanHash: "b".repeat(64),
      expectedStatus: "STATEMENT_CLOSED",
      idempotencyKey: "mark-paid-key-2",
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_RECONCILIATION_OPERATOR",
  );
});

test("mark-paid selects one reviewed case when the workspace has multiple candidates and uses statement CAS", async (t) => {
  const statementA = { _id: "507f1f77bcf86cd799439021", workspaceId: "workspace-a", paymentStatus: "STATEMENT_CLOSED", paidAmount: null, paidAt: null, updatedAt: new Date("2026-08-16T00:00:00.000Z") };
  const statementB = { _id: "507f1f77bcf86cd799439022", workspaceId: "workspace-a", paymentStatus: "OPEN", paidAmount: null, paidAt: null, updatedAt: new Date("2026-08-16T00:01:00.000Z") };
  const paymentA = { ...payment, _id: "507f1f77bcf86cd799439031", statementId: statementA._id };
  const paymentB = { ...payment, _id: "507f1f77bcf86cd799439032", statementId: statementB._id };
  const chargeA = { _id: "507f1f77bcf86cd799439041", statementId: statementA._id, transactionType: "EXPENSE", amount: 1000, creditDebt: 1000, accountId: account._id };
  const chargeB = { _id: "507f1f77bcf86cd799439042", statementId: statementB._id, transactionType: "EXPENSE", amount: 1000, creditDebt: 1000, accountId: account._id };
  const statements = [statementA, statementB];
  const transactions = [paymentA, paymentB, chargeA, chargeB];
  const plan = planLegacyStatementPaymentRepairs(statements, transactions, [account]);
  const caseDoc = { _id: "507f1f77bcf86cd799439099", workspaceId: "workspace-a", kind: "LEGACY_STATEMENT_PAYMENT", statementId: statementA._id, transactionId: paymentA._id, classification: "ELIGIBLE_MARK_PAID", reason: "FULL_SETTLEMENT_REQUIRES_OPERATOR_APPROVAL", status: "OPEN", snapshot: { amount: 1000, accountId: account._id, previousStatus: "STATEMENT_CLOSED", paidAt: "2026-08-15T10:00:00.000Z", sourceHash: plan.sourceHash, planHash: reconciliationPlanHash(plan) } };
  const chain = <T>(value: T) => ({ session: () => ({ lean: async () => value }), lean: async () => value });
  let statementUpdateFilter: Record<string, unknown> | undefined;
  t.mock.method(commandGuardService, "execute", async (_context: ServiceContext, _spec: CommandGuardSpec, work: (session: never) => Promise<unknown>) => work({} as never));
  t.mock.method(FinancialReconciliationCaseModel, "findOne", () => chain(caseDoc) as never);
  t.mock.method(CardStatementModel, "findOne", () => chain(statementA) as never);
  t.mock.method(CardStatementModel, "find", () => chain(statements) as never);
  t.mock.method(FinancialTransactionModel, "find", () => chain(transactions) as never);
  t.mock.method(AccountModel, "find", () => chain([account]) as never);
  t.mock.method(CardStatementModel, "findOneAndUpdate", (filter: Record<string, unknown>) => { statementUpdateFilter = filter; return { lean: async () => ({ ...statementA, paymentStatus: "PAID", paidAmount: 1000, paidAt: new Date("2026-08-15T10:00:00.000Z") }) } as never; });
  t.mock.method(FinancialReconciliationCaseModel, "findOneAndUpdate", () => chain({ ...caseDoc, status: "RESOLVED" }) as never);
  const result = await markLegacyStatementPaymentPaid(
    { workspaceId: "workspace-a", userId: "operator-a", role: "admin", channel: "job", correlationId: "mark-paid-correlation" },
    { caseId: caseDoc._id, sourceHash: plan.sourceHash, planHash: reconciliationPlanHash(plan), currentSourceHash: plan.sourceHash, currentPlanHash: reconciliationPlanHash(plan), expectedStatus: "STATEMENT_CLOSED", idempotencyKey: "mark-paid-key-3" },
  );
  assert.equal(result.statementId, statementA._id);
  assert.equal(result.transactionId, paymentA._id);
  assert.equal(statementUpdateFilter?.updatedAt, statementA.updatedAt);
});
