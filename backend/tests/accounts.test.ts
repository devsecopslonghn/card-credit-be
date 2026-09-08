import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import mongoose from "mongoose";
import { AccountService } from "../src/services/account-service.js";
import { AccountModel } from "../src/models/account.js";
import { CreditCardModel } from "../src/models/credit-card.js";
import { McpMutationModel } from "../src/models/mcp-mutation.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { StatementQueryService } from "../src/services/statement-query-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";
import { canonicalPayloadHash, legacyPayloadHash } from "../src/command-hash.js";
import { commandGuardService, type CommandGuardSpec } from "../src/services/command-guard-service.js";

const context: ServiceContext = {
  workspaceId: "workspace-a",
  userId: "user-a",
  role: "user",
  channel: "browser",
  correlationId: "account-test",
};
const cardId = "507f1f77bcf86cd799439011";
const input = { name: "Credit account", type: "CREDIT" as const, creditCardId: cardId, openingBalance: 0 };
const query = <T>(value: T) => ({ session() { return this; }, lean: async () => value });
const invocation = (idempotencyKey: string) => ({ idempotencyKey, endpointOrTool: "test.account" });
const mockGuard = (t: TestContext) => {
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, _spec: CommandGuardSpec, work: (session: mongoose.ClientSession) => Promise<unknown>) => work({} as mongoose.ClientSession));
};

test("CREDIT account validates an active card in the same workspace before create", async (t) => {
  mockGuard(t);
  t.mock.method(McpMutationModel, "findOne", () => query(null) as never);
  const cardFind = t.mock.method(CreditCardModel, "findOne", (filter: Record<string, unknown>) => {
    assert.deepEqual(filter, { _id: cardId, workspaceId: "workspace-a", active: { $ne: false } });
    return query({ _id: cardId, workspaceId: "workspace-a", active: true }) as never;
  });
  const accountCreate = t.mock.method(AccountModel, "create", async (value: Record<string, unknown>) => ({ _id: "507f1f77bcf86cd799439012", ...value }) as never);

  const result = await AccountService.create(context, input, invocation("account-create-1"));

  assert.equal(result.creditCardId, cardId);
  assert.equal(cardFind.mock.callCount(), 1);
  assert.equal(accountCreate.mock.callCount(), 1);
});

test("CREDIT account rejects missing, inactive or cross-workspace cards without creating", async (t) => {
  mockGuard(t);
  t.mock.method(McpMutationModel, "findOne", () => query(null) as never);
  const cardFind = t.mock.method(CreditCardModel, "findOne", () => query(null) as never);
  const accountCreate = t.mock.method(AccountModel, "create", async () => { throw new Error("account create must not run"); });

  await assert.rejects(() => AccountService.create(context, input, invocation("account-create-2")), (error: { code?: string; statusCode?: number }) => error.code === "CARD_NOT_FOUND" && error.statusCode === 404);
  assert.equal(cardFind.mock.callCount(), 1);
  assert.equal(accountCreate.mock.callCount(), 0);
});

test("malformed CREDIT card id fails closed before card or account reads", async (t) => {
  mockGuard(t);
  t.mock.method(McpMutationModel, "findOne", () => query(null) as never);
  const cardFind = t.mock.method(CreditCardModel, "findOne");
  const accountCreate = t.mock.method(AccountModel, "create");

  await assert.rejects(() => AccountService.create(context, { ...input, creditCardId: "not-an-object-id" }, invocation("account-create-3")), (error: { code?: string; statusCode?: number }) => error.code === "INVALID_CARD_ID" && error.statusCode === 400);
  assert.equal(cardFind.mock.callCount(), 0);
  assert.equal(accountCreate.mock.callCount(), 0);
});

test("non-CREDIT card link remains a boundary error without card lookup", async (t) => {
  const cardFind = t.mock.method(CreditCardModel, "findOne");
  await assert.rejects(() => AccountService.create(context, { name: "Debit", type: "DEBIT", creditCardId: cardId, openingBalance: 0 }, invocation("account-create-4")), (error: { code?: string; statusCode?: number }) => error.code === "INVALID_ACCOUNT" && error.statusCode === 400);
  assert.equal(cardFind.mock.callCount(), 0);
});

test("idempotent account replay returns the stored result before card validation", async (t) => {
  mockGuard(t);
  const hash = canonicalPayloadHash(input);
  const replayCardFind = t.mock.method(CreditCardModel, "findOne");
  const replayCreate = t.mock.method(AccountModel, "create");
  const stored = { id: "account-existing", name: input.name, type: "CREDIT", group: "DEBT", currency: "VND", active: true, creditCardId: cardId, openingBalance: 0, currentBalance: 0, currentDebt: 0 };
  t.mock.method(McpMutationModel, "findOne", () => query({ payloadHash: hash, result: stored }) as never);

  const result = await AccountService.create(context, input, invocation("idempotency-1"));
  assert.deepEqual(result, stored);
  assert.equal(replayCardFind.mock.callCount(), 0);
  assert.equal(replayCreate.mock.callCount(), 0);
});

test("idempotent account replay accepts a legacy McpMutation payload hash", async (t) => {
  mockGuard(t);
  const replayCardFind = t.mock.method(CreditCardModel, "findOne");
  const replayCreate = t.mock.method(AccountModel, "create");
  const stored = { id: "account-legacy", name: input.name, type: "CREDIT", group: "DEBT", currency: "VND", active: true, creditCardId: cardId, openingBalance: 0, currentBalance: 0, currentDebt: 0 };
  t.mock.method(McpMutationModel, "findOne", () => query({ payloadHash: legacyPayloadHash(input), result: stored }) as never);

  const result = await AccountService.create(context, input, invocation("legacy-key"));
  assert.deepEqual(result, stored);
  assert.equal(replayCardFind.mock.callCount(), 0);
  assert.equal(replayCreate.mock.callCount(), 0);
});

test("new account commands use the persistent guard and keep the adapter metadata", async (t) => {
  const input = { name: "Cash command", type: "CASH" as const, openingBalance: 1000 };
  t.mock.method(McpMutationModel, "findOne", () => query(null) as never);
  const accountCreate = t.mock.method(AccountModel, "create", async (value: Record<string, unknown> | Array<Record<string, unknown>>) => {
    const record = Array.isArray(value) ? value[0] : value;
    return (Array.isArray(value) ? [{ _id: "507f1f77bcf86cd799439013", ...record }] : { _id: "507f1f77bcf86cd799439013", ...record }) as never;
  });
  let observed: Record<string, unknown> | undefined;
  t.mock.method(commandGuardService, "execute", async (_ctx: ServiceContext, spec: CommandGuardSpec, work: (session: mongoose.ClientSession) => Promise<unknown>) => {
    observed = spec as unknown as Record<string, unknown>;
    return work({} as mongoose.ClientSession);
  });

  const result = await AccountService.create(context, input, { idempotencyKey: "account-command-1", endpointOrTool: "confirm_create_account" });
  assert.equal(result.id, "507f1f77bcf86cd799439013");
  assert.equal(accountCreate.mock.callCount(), 1);
  assert.equal(observed?.operation, "create_account");
  assert.equal(observed?.endpointOrTool, "confirm_create_account");
});

test("linked CREDIT accounts calculate current debt from statement outstanding, including payments made from another account", async (t) => {
  const creditAccount = {
    _id: "account-max",
    name: "Credit: Max Card",
    type: "CREDIT",
    creditCardId: cardId,
    openingBalance: 0,
    active: true,
  };
  t.mock.method(AccountModel, "find", () => ({
    sort: () => ({ lean: async () => [creditAccount] }),
  }) as never);
  t.mock.method(FinancialTransactionModel, "aggregate", async () => [
    { _id: "account-max", creditDebt: 31_062_840, debitCashflow: 0 },
  ] as never);
  t.mock.method(StatementQueryService, "list", async () => [{
    cardId,
    summary: { statementAmount: 16_193_000, paymentAmount: 16_193_000, outstandingAmount: 0 },
  }] as never);

  const [result] = await AccountService.list(context);

  assert.equal(result?.currentDebt, 0);
});
