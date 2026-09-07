import mongoose from "mongoose";

export type Note = { id?: string; workspaceId: string; date: string; content: string };
export const NOTES_DEFAULT_LIMIT = 100;
export const NOTES_MAX_LIMIT = 100;
export interface NotesRepository {
  list(workspaceId: string, limit?: number): Promise<Note[]>;
  upsert(workspaceId: string, date: string, content: string): Promise<Note>;
  remove(workspaceId: string, date: string): Promise<void>;
}
const serialize = (value: Record<string, unknown>): Note => ({
  id: value._id ? String(value._id) : undefined,
  workspaceId: String(value.workspaceId), date: String(value.date), content: String(value.content ?? ""),
});
export class MongoNotesRepository implements NotesRepository {
  private collection() { return mongoose.connection.collection("calendarnotes"); }
  async list(workspaceId: string, limit = NOTES_DEFAULT_LIMIT) { return (await this.collection().find({ workspaceId }).sort({ date: -1 }).limit(limit).toArray()).map(serialize); }
  async upsert(workspaceId: string, date: string, content: string) { const result = await this.collection().findOneAndUpdate({ workspaceId, date }, { $set: { workspaceId, date, content, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true, returnDocument: "after" }); return serialize(result!); }
  async remove(workspaceId: string, date: string) { await this.collection().deleteOne({ workspaceId, date }); }
}
export class InMemoryNotesRepository implements NotesRepository {
  notes: Note[] = [];
  async list(workspaceId: string, limit = NOTES_DEFAULT_LIMIT) { return structuredClone(this.notes.filter((note) => note.workspaceId === workspaceId).sort((left, right) => right.date.localeCompare(left.date)).slice(0, limit)); }
  async upsert(workspaceId: string, date: string, content: string) { const current = this.notes.find((note) => note.workspaceId === workspaceId && note.date === date); if (current) current.content = content; else this.notes.push({ workspaceId, date, content }); return structuredClone(this.notes.find((note) => note.workspaceId === workspaceId && note.date === date)!); }
  async remove(workspaceId: string, date: string) { this.notes = this.notes.filter((note) => note.workspaceId !== workspaceId || note.date !== date); }
}
