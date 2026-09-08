import { ApiError } from "../errors.js";
import { NOTES_DEFAULT_LIMIT, NOTES_MAX_LIMIT, type NotesRepository, type Note } from "../notes.js";
import type { ServiceContext } from "./types/service-context.js";

export type NoteInput = { date?: unknown; content?: unknown };
const boundedLimit = (value: unknown) => Math.min(Math.max(Number.parseInt(typeof value === "string" ? value : String(NOTES_DEFAULT_LIMIT), 10) || NOTES_DEFAULT_LIMIT, 1), NOTES_MAX_LIMIT);

export class NotesService {
  static async list(context: ServiceContext, rawLimit: unknown, repository: Pick<NotesRepository, "list">) {
    return repository.list(context.workspaceId, boundedLimit(rawLimit));
  }

  static async save(context: ServiceContext, input: NoteInput, repository: Pick<NotesRepository, "upsert" | "remove">): Promise<Note | { message: string }> {
    const date = typeof input.date === "string" ? input.date : "";
    if (!date) throw new ApiError(400, "INVALID_REQUEST", "Thiếu thông tin ngày!");
    const content = typeof input.content === "string" ? input.content.trim() : "";
    if (!content) {
      await repository.remove(context.workspaceId, date);
      return { message: "Đã xóa ghi chú trống" };
    }
    return repository.upsert(context.workspaceId, date, content);
  }
}
