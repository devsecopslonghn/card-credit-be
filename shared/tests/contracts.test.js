import assert from "node:assert/strict";
import test from "node:test";
import {
  accountListSchema,
  createAccountInputSchema,
  createApiErrorBody,
  createRealMoneyAccountInputSchema,
  isApiErrorBody,
} from "../src/index.js";

test("creates and recognizes the stable error envelope", () => {
  const body = createApiErrorBody("INVALID_REQUEST", "Invalid", { name: "Required" });
  assert.deepEqual(body, {
    error: { code: "INVALID_REQUEST", message: "Invalid", fields: { name: "Required" } },
  });
  assert.equal(isApiErrorBody(body), true);
  assert.equal(isApiErrorBody({ message: "no" }), false);
});

test("account contracts normalize inputs and reject invalid card links", () => {
  assert.deepEqual(createRealMoneyAccountInputSchema.parse({ name: "  Ví  ", type: "CASH" }), {
    name: "Ví",
    type: "CASH",
    openingBalance: 0,
  });
  assert.equal(createAccountInputSchema.safeParse({ name: "Cash", type: "CASH", creditCardId: "card-1" }).success, false);
  assert.equal(accountListSchema.parse([{
    id: "account-1",
    name: "Cash",
    type: "CASH",
    group: "REAL_MONEY",
    currency: "VND",
    active: true,
    creditCardId: null,
    openingBalance: 0,
    currentBalance: 0,
    currentDebt: 0,
  }]).length, 1);
});

test("REST and MCP transport envelopes preserve the same account business DTO", () => {
  const fixture = [{
    id: "account-1",
    name: "Cash",
    type: "CASH",
    group: "REAL_MONEY",
    currency: "VND",
    active: true,
    creditCardId: null,
    openingBalance: 0,
    currentBalance: 120000,
    currentDebt: 0,
  }];
  const restDto = accountListSchema.parse({ data: fixture }.data);
  const mcpDto = accountListSchema.parse(JSON.parse(JSON.stringify(fixture)));
  assert.deepEqual(restDto, mcpDto);
});
