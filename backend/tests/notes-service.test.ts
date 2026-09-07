import assert from "node:assert/strict";
import test from "node:test";
import { NotesService } from "../src/services/notes-service.js";
import type { ServiceContext } from "../src/services/types/service-context.js";

const context: ServiceContext = {
  userId: "user-1", workspaceId: "workspace-a", role: "user", channel: "browser", correlationId: "request-1",
};

test("notes service scopes list and save operations to trusted workspace", async () => {
  const calls: Array<{ operation: string; workspaceId: string; limit?: number; date?: string; content?: string }> = [];
  const repository = {
    list: async (workspaceId: string, limit?: number) => { calls.push({ operation: "list", workspaceId, limit }); return []; },
    upsert: async (workspaceId: string, date: string, content: string) => { calls.push({ operation: "upsert", workspaceId, date, content }); return { workspaceId, date, content }; },
    remove: async (workspaceId: string, date: string) => { calls.push({ operation: "remove", workspaceId, date }); },
  };

  await NotesService.list(context, undefined, repository);
  const saved = await NotesService.save(context, { date: "2026-07-11", content: "  Note  " }, repository);
  assert.equal((saved as { content: string }).content, "Note");
  assert.deepEqual(calls, [
    { operation: "list", workspaceId: "workspace-a", limit: 100 },
    { operation: "upsert", workspaceId: "workspace-a", date: "2026-07-11", content: "Note" },
  ]);
});

test("notes service clamps oversized list reads before repository execution", async () => {
  let receivedLimit = 0;
  await NotesService.list(context, "1000", { list: async (_workspaceId, limit) => { receivedLimit = limit ?? 0; return []; } });
  assert.equal(receivedLimit, 100);
});

test("notes service removes blank content and preserves legacy response", async () => {
  let removed: { workspaceId: string; date: string } | undefined;
  const result = await NotesService.save(context, { date: "2026-07-11", content: "  " }, {
    upsert: async () => ({ workspaceId: "unexpected", date: "unexpected", content: "unexpected" }),
    remove: async (workspaceId, date) => { removed = { workspaceId, date }; },
  });
  assert.deepEqual(removed, { workspaceId: "workspace-a", date: "2026-07-11" });
  assert.deepEqual(result, { message: "Đã xóa ghi chú trống" });
});

test("notes service rejects missing date before repository access", async () => {
  let writes = 0;
  const repository = {
    upsert: async () => { writes += 1; return { workspaceId: "workspace-a", date: "", content: "unexpected" }; },
    remove: async () => { writes += 1; },
  };
  await assert.rejects(() => NotesService.save(context, { content: "Note" }, repository), (error) => (error as { code?: string }).code === "INVALID_REQUEST");
  assert.equal(writes, 0);
});
