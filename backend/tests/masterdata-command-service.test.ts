import assert from "node:assert/strict";
import test from "node:test";
import { MasterdataCommandService } from "../src/services/masterdata-command-service.js";
import type { MasterdataRepository, MasterRecord } from "../src/masterdata.js";

const admin = { workspaceId: "global", userId: "admin", role: "admin" as const, channel: "browser" as const, correlationId: "masterdata-command" };
const user = { ...admin, role: "user" as const };

class FakeMasterdata implements MasterdataRepository {
  readonly calls: string[] = [];
  duplicate: MasterRecord | null = null;
  async list() { return []; }
  async findInsensitive(kind: "banks" | "cardtypes", field: string, value: string) { this.calls.push(`find:${kind}:${field}:${value}`); return this.duplicate; }
  async create(kind: "banks" | "cardtypes", value: MasterRecord) { this.calls.push(`create:${kind}`); return { ...value, _id: "created" }; }
  async update(kind: "banks" | "cardtypes", id: string, value: MasterRecord) { this.calls.push(`update:${kind}:${id}`); return { ...value, _id: id }; }
  async remove(kind: "banks" | "cardtypes", id: string) { this.calls.push(`remove:${kind}:${id}`); }
}

test("masterdata command service enforces trusted admin before repository work", async () => {
  const repository = new FakeMasterdata();
  await assert.rejects(() => MasterdataCommandService.create(user, "banks", { shortname: "TST" }, repository), (error) => (error as { code?: string }).code === "FORBIDDEN");
  assert.deepEqual(repository.calls, []);
});

test("masterdata command service normalizes duplicate lookup and preserves create payload", async () => {
  const repository = new FakeMasterdata();
  const created = await MasterdataCommandService.create(admin, "banks", { shortname: "  TST  ", name: "Test" }, repository);
  assert.deepEqual(repository.calls, ["find:banks:shortname:TST", "create:banks"]);
  assert.equal(created.record?._id, "created");
  repository.duplicate = { _id: "existing", shortname: "TST" };
  const duplicate = await MasterdataCommandService.create(admin, "banks", { shortname: "tst" }, repository);
  assert.equal(duplicate.duplicateMessage, "Ngân hàng có mã viết tắt tst đã tồn tại trong hệ thống.");
  assert.equal(repository.calls.at(-1), "find:banks:shortname:tst");
});

test("masterdata command service delegates update and remove after admin check", async () => {
  const repository = new FakeMasterdata();
  await MasterdataCommandService.update(admin, "cardtypes", "type-1", { name: "Visa" }, repository);
  await MasterdataCommandService.remove(admin, "cardtypes", "type-1", repository);
  assert.deepEqual(repository.calls, ["update:cardtypes:type-1", "remove:cardtypes:type-1"]);
});
