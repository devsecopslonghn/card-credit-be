import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, canonicalPayloadHash } from "../src/command-hash.js";

test("command payload hash is stable across object key order and preserves array order", () => {
  assert.equal(canonicalJson({ nested: { b: 2, a: 1 }, items: ["a", "b"] }), canonicalJson({ items: ["a", "b"], nested: { a: 1, b: 2 } }));
  assert.equal(canonicalPayloadHash({ nested: { b: 2, a: 1 } }), canonicalPayloadHash({ nested: { a: 1, b: 2 } }));
  assert.notEqual(canonicalPayloadHash({ items: ["a", "b"] }), canonicalPayloadHash({ items: ["b", "a"] }));
});

test("command payload hash fails closed for unsupported values and cycles", () => {
  assert.throws(() => canonicalPayloadHash({ value: undefined }), /Invalid command payload/);
  assert.throws(() => canonicalPayloadHash({ value: Number.NaN }), /Invalid command payload/);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => canonicalPayloadHash(cycle), /Invalid command payload/);
});
