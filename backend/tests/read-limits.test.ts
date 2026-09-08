import assert from "node:assert/strict";
import test from "node:test";
import { boundedReadLimit, READ_DEFAULT_LIMIT, READ_MAX_LIMIT } from "../src/read-limits.js";

test("bounded read limit defaults and clamps every list boundary", () => {
  assert.equal(READ_DEFAULT_LIMIT, 100);
  assert.equal(READ_MAX_LIMIT, 100);
  assert.equal(boundedReadLimit(undefined), 100);
  assert.equal(boundedReadLimit(25), 25);
  assert.equal(boundedReadLimit(0), 100);
  assert.equal(boundedReadLimit("25"), 25);
  assert.equal(boundedReadLimit("0"), 100);
  assert.equal(boundedReadLimit("1000"), 100);
  assert.equal(boundedReadLimit("not-a-number"), 100);
});
