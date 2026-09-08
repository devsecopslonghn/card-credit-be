import assert from "node:assert/strict";
import test from "node:test";
import { CommandAuditModel } from "../src/models/command-audit.js";
import { CommandReceiptModel, type CommandReceiptDocument } from "../src/models/command-receipt.js";
import { CommandPreviewModel } from "../src/models/command-preview.js";
import { CommandGuardService, CommandReceiptReservationConflict, type CommandGuardRepository } from "../src/services/command-guard-service.js";
import { canonicalPayloadHash } from "../src/command-hash.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

type Receipt = CommandReceiptDocument & { _id: string };

class FakeRepository implements CommandGuardRepository {
  receipts = new Map<string, Receipt>();
  audits: Array<Record<string, unknown>> = [];
  previews = new Map<string, { workspaceId: string; userId: string; channel: string; operation: string; previewId: string; payloadHash: string; tokenHash: string; status: "ISSUED" | "CONSUMED"; expiresAt: Date; }>();
  nextId = 1;
  completeResult = true;
  async startSession() { return {
    withTransaction: async (callback: () => Promise<void>) => {
      const receipts = new Map(this.receipts);
      const audits = [...this.audits];
      const previews = new Map([...this.previews].map(([key, value]) => [key, { ...value, expiresAt: new Date(value.expiresAt) }]));
      try { await callback(); } catch (error) { this.receipts = receipts; this.audits = audits; this.previews = previews; throw error; }
    },
    endSession: async () => undefined,
  } as never; }
  async findReceipt(filter: Record<string, unknown>) {
    return [...this.receipts.values()].find((value) => value.workspaceId === filter.workspaceId && value.operation === filter.operation && value.idempotencyKey === filter.idempotencyKey) ?? null;
  }
  async insertReceipt(record: Record<string, unknown>) {
    const key = `${record.workspaceId}:${record.operation}:${record.idempotencyKey}`;
    if ([...this.receipts.values()].some((value) => `${value.workspaceId}:${value.operation}:${value.idempotencyKey}` === key)) throw new CommandReceiptReservationConflict();
    const created = { ...record, _id: `receipt-${this.nextId++}` } as Receipt;
    this.receipts.set(created._id, created);
    return created;
  }
  async completeReceipt(filter: Record<string, unknown>, result: unknown) {
    const receipt = this.receipts.get(String(filter._id));
    if (!receipt) return false;
    receipt.status = "COMPLETED";
    receipt.result = result;
    return this.completeResult;
  }
  async insertAudit(record: Record<string, unknown>) { this.audits.push(record); }
  async consumePreview(filter: Record<string, unknown>) {
    const preview = [...this.previews.values()].find((value) => value.workspaceId === filter.workspaceId && value.userId === filter.userId && value.channel === filter.channel && value.operation === filter.operation && value.previewId === filter.previewId && value.payloadHash === filter.payloadHash && value.tokenHash === filter.tokenHash);
    if (!preview) return "NOT_FOUND" as const;
    if (preview.status === "CONSUMED") return "ALREADY_CONSUMED" as const;
    if (preview.expiresAt.valueOf() <= Date.now()) return "EXPIRED" as const;
    preview.status = "CONSUMED";
    return "CONSUMED" as const;
  }
}

const context: ServiceContext = { workspaceId: "workspace-a", userId: "user-a", role: "user", channel: "mcp", correlationId: "corr-a" };
const spec = { operation: "create_account", idempotencyKey: "command-key-1", payloadHash: canonicalPayloadHash({ name: "Cash" }), endpointOrTool: "confirm_create_account", resource: { type: "account", id: "account-1" } };

test("command guard completes once, audits success and replays without running work", async () => {
  const repository = new FakeRepository();
  const guard = new CommandGuardService(repository);
  let calls = 0;
  const first = await guard.execute(context, spec, async () => { calls += 1; return { id: "account-1" }; });
  const replay = await guard.execute(context, spec, async () => { calls += 1; return { id: "unexpected" }; });
  assert.deepEqual(first, { id: "account-1" });
  assert.deepEqual(replay, first);
  assert.equal(calls, 1);
  assert.equal(repository.receipts.size, 1);
  assert.equal(repository.audits.length, 1);
  assert.equal(repository.audits[0]?.outcome, "SUCCESS");
  assert.equal("payload" in (repository.audits[0] ?? {}), false);
});

test("command guard rejects payload mismatch and pending receipt", async () => {
  const repository = new FakeRepository();
  const guard = new CommandGuardService(repository);
  await guard.execute(context, spec, async () => "done");
  await assert.rejects(() => guard.execute(context, { ...spec, payloadHash: canonicalPayloadHash({ name: "Other" }) }, async () => "bad"), (error: unknown) => error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_PAYLOAD_MISMATCH");
  repository.receipts.clear();
  repository.receipts.set("pending", { ...spec, _id: "pending", workspaceId: context.workspaceId, userId: context.userId, channel: context.channel, status: "PENDING" });
  await assert.rejects(() => guard.execute(context, spec, async () => "bad"), (error: unknown) => error instanceof Error && "code" in error && error.code === "COMMAND_IN_PROGRESS");
});

test("command guard rejects orphaned preview metadata instead of falling back to command hash", async () => {
  const guard = new CommandGuardService(new FakeRepository());
  await assert.rejects(() => guard.execute(context, { ...spec, previewId: "preview-orphan" }, async () => "bad"), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PREVIEW_CONFIRMATION");
  await assert.rejects(() => guard.execute(context, { ...spec, confirmationTokenHash: "a".repeat(64) }, async () => "bad"), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_PREVIEW_CONFIRMATION");
});

test("concurrent command guard calls run business work once and rollback failed work", async () => {
  const repository = new FakeRepository();
  const guard = new CommandGuardService(repository);
  let calls = 0;
  const first = guard.execute(context, spec, async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 15)); return "done"; });
  await new Promise((resolve) => setTimeout(resolve, 1));
  const second = guard.execute(context, spec, async () => { calls += 1; return "bad"; });
  await assert.rejects(second, (error: unknown) => error instanceof Error && "code" in error && error.code === "COMMAND_IN_PROGRESS");
  assert.equal(await first, "done");
  assert.equal(calls, 1);

  const failing = new FakeRepository();
  const failingGuard = new CommandGuardService(failing);
  await assert.rejects(() => failingGuard.execute(context, spec, async () => { throw new Error("business failed"); }));
  assert.equal(failing.receipts.size, 0);
  assert.equal(failing.audits.length, 0);
});

test("command guard accepts only safe resource metadata and declares additive indexes", async () => {
  await assert.rejects(() => new CommandGuardService(new FakeRepository()).execute(context, { ...spec, resource: { payload: "secret" } }, async () => "bad"), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_COMMAND_RESOURCE");
  const receiptIndexes = CommandReceiptModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; [key: string]: unknown }]>;
  const auditIndexes = CommandAuditModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; [key: string]: unknown }]>;
  const previewIndexes = CommandPreviewModel.schema.indexes() as Array<[Record<string, unknown>, { name?: string; [key: string]: unknown }]>;
  assert.equal(receiptIndexes.some(([, options]) => options.name === "command_receipt_unique"), true);
  assert.equal(auditIndexes.some(([, options]) => options.name === "command_audit_workspace_created"), true);
  assert.equal(previewIndexes.some(([, options]) => options.name === "command_preview_unique"), true);
  assert.equal(previewIndexes.some(([, options]) => options.name === "command_preview_token_unique"), true);
  assert.equal(previewIndexes.some(([, options]) => options.name === "command_preview_expiry"), true);
});

test("command guard consumes one preview atomically and allows only same-key replay", async () => {
  const repository = new FakeRepository();
  const guard = new CommandGuardService(repository);
  const tokenHash = "a".repeat(64);
  repository.previews.set("preview-1", { workspaceId: context.workspaceId, userId: context.userId, channel: context.channel, operation: spec.operation, previewId: "preview-1", payloadHash: spec.payloadHash, tokenHash, status: "ISSUED", expiresAt: new Date(Date.now() + 60_000) });
  const previewSpec = { ...spec, previewId: "preview-1", confirmationTokenHash: tokenHash, previewPayloadHash: spec.payloadHash, idempotencyKey: "preview-command-1" };
  let calls = 0;
  const first = await guard.execute(context, previewSpec, async () => { calls += 1; return { id: "account-1" }; });
  const replay = await guard.execute(context, previewSpec, async () => { calls += 1; return { id: "unexpected" }; });
  assert.deepEqual(replay, first);
  assert.equal(calls, 1);
  assert.equal(repository.previews.get("preview-1")?.status, "CONSUMED");
  await assert.rejects(() => guard.execute(context, { ...previewSpec, idempotencyKey: "preview-command-2" }, async () => { calls += 1; return { id: "bad" }; }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PREVIEW_ALREADY_CONSUMED");
  assert.equal(calls, 1);
});

test("command guard rolls preview consumption back on business failure and reports expiry", async () => {
  const tokenHash = "b".repeat(64);
  const failingRepository = new FakeRepository();
  failingRepository.previews.set("preview-fail", { workspaceId: context.workspaceId, userId: context.userId, channel: context.channel, operation: spec.operation, previewId: "preview-fail", payloadHash: spec.payloadHash, tokenHash, status: "ISSUED", expiresAt: new Date(Date.now() + 60_000) });
  const failingGuard = new CommandGuardService(failingRepository);
  const failingSpec = { ...spec, previewId: "preview-fail", confirmationTokenHash: tokenHash, previewPayloadHash: spec.payloadHash, idempotencyKey: "preview-failure-1" };
  await assert.rejects(() => failingGuard.execute(context, failingSpec, async () => { throw new Error("business failed"); }));
  assert.equal(failingRepository.receipts.size, 0);
  assert.equal(failingRepository.previews.get("preview-fail")?.status, "ISSUED");

  const expiredRepository = new FakeRepository();
  expiredRepository.previews.set("preview-expired", { workspaceId: context.workspaceId, userId: context.userId, channel: context.channel, operation: spec.operation, previewId: "preview-expired", payloadHash: spec.payloadHash, tokenHash, status: "ISSUED", expiresAt: new Date(Date.now() - 1) });
  const expiredGuard = new CommandGuardService(expiredRepository);
  await assert.rejects(() => expiredGuard.execute(context, { ...spec, previewId: "preview-expired", confirmationTokenHash: tokenHash, previewPayloadHash: spec.payloadHash, idempotencyKey: "preview-expired-1" }, async () => "bad"), (error: unknown) => error instanceof Error && "code" in error && error.code === "PREVIEW_EXPIRED");
  assert.equal(expiredRepository.receipts.size, 0);
});

test("command guard does not retry duplicate errors raised by business work", async () => {
  const repository = new FakeRepository();
  const guard = new CommandGuardService(repository);
  let calls = 0;
  const duplicate = Object.assign(new Error("business duplicate"), { code: 11000 });
  await assert.rejects(() => guard.execute(context, spec, async () => {
    calls += 1;
    throw duplicate;
  }), (error: unknown) => error === duplicate);
  assert.equal(calls, 1);
  assert.equal(repository.receipts.size, 0);
});

test("command guard aborts when receipt completion does not match", async () => {
  const repository = new FakeRepository();
  repository.completeResult = false;
  const guard = new CommandGuardService(repository);
  await assert.rejects(() => guard.execute(context, spec, async () => "done"), (error: unknown) => error instanceof Error && "code" in error && error.code === "COMMAND_RECEIPT_COMPLETION_FAILED");
  assert.equal(repository.receipts.size, 0);
  assert.equal(repository.audits.length, 0);
});
