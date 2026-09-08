import { ApiError } from "../errors.js";
import type { MasterdataRepository, MasterRecord } from "../masterdata.js";
import type { ServiceContext } from "./types/service-context.js";

export type MasterdataKind = "banks" | "cardtypes";

type CommandResult = { record?: MasterRecord; duplicateMessage?: string };

const definition = (kind: MasterdataKind) => kind === "banks"
  ? { field: "shortname", duplicate: (value: string) => `Ngân hàng có mã viết tắt ${value} đã tồn tại trong hệ thống.` }
  : { field: "name", duplicate: (value: string) => `Loại thẻ ${value} đã tồn tại trong hệ thống.` };

const requireAdmin = (ctx: ServiceContext) => {
  if (ctx.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
};

export class MasterdataCommandService {
  static async create(ctx: ServiceContext, kind: MasterdataKind, body: MasterRecord, repository: MasterdataRepository): Promise<CommandResult> {
    requireAdmin(ctx);
    const config = definition(kind);
    const value = String(body?.[config.field] ?? "").trim();
    if (await repository.findInsensitive(kind, config.field, value)) return { duplicateMessage: config.duplicate(value) };
    return { record: await repository.create(kind, body) };
  }

  static async update(ctx: ServiceContext, kind: MasterdataKind, id: string, body: MasterRecord, repository: MasterdataRepository) {
    requireAdmin(ctx);
    return repository.update(kind, id, body);
  }

  static async remove(ctx: ServiceContext, kind: MasterdataKind, id: string, repository: MasterdataRepository) {
    requireAdmin(ctx);
    await repository.remove(kind, id);
  }
}
