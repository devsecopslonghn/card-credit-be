import mongoose from "mongoose";
export type MasterRecord = Record<string, unknown> & { _id?: unknown };
export const MASTERDATA_DEFAULT_LIMIT = 100;
export const MASTERDATA_MAX_LIMIT = 100;
export interface MasterdataRepository {
  list(kind: "banks" | "cardtypes", sortField: string, limit?: number): Promise<MasterRecord[]>;
  findInsensitive(kind: "banks" | "cardtypes", field: string, value: string): Promise<MasterRecord | null>;
  create(kind: "banks" | "cardtypes", value: MasterRecord): Promise<MasterRecord>;
  update(kind: "banks" | "cardtypes", id: string, value: MasterRecord): Promise<MasterRecord | null>;
  remove(kind: "banks" | "cardtypes", id: string): Promise<void>;
}
export class MongoMasterdataRepository implements MasterdataRepository {
  private collection(kind: "banks" | "cardtypes") { return mongoose.connection.collection(kind); }
  async list(kind: "banks" | "cardtypes", sortField: string, limit = MASTERDATA_DEFAULT_LIMIT) { return this.collection(kind).find().sort({ [sortField]: 1 }).limit(limit).toArray(); }
  async findInsensitive(kind: "banks" | "cardtypes", field: string, value: string) { return this.collection(kind).findOne({ [field]: { $regex: `^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }); }
  async create(kind: "banks" | "cardtypes", value: MasterRecord) { const { _id: _ignored, ...fields } = value; void _ignored; const now = new Date(); const result = await this.collection(kind).insertOne({ ...fields, createdAt: now, updatedAt: now }); return { ...fields, _id: result.insertedId, createdAt: now, updatedAt: now }; }
  async update(kind: "banks" | "cardtypes", id: string, value: MasterRecord) { return this.collection(kind).findOneAndUpdate({ _id: new mongoose.Types.ObjectId(id) }, { $set: { ...value, updatedAt: new Date() } }, { returnDocument: "after" }); }
  async remove(kind: "banks" | "cardtypes", id: string) { await this.collection(kind).deleteOne({ _id: new mongoose.Types.ObjectId(id) }); }
}
export class InMemoryMasterdataRepository implements MasterdataRepository {
  values: Record<"banks" | "cardtypes", MasterRecord[]> = { banks: [], cardtypes: [] };
  async list(kind: "banks" | "cardtypes", sortField: string, limit = MASTERDATA_DEFAULT_LIMIT) { return structuredClone(this.values[kind]).sort((a, b) => String(a[sortField]).localeCompare(String(b[sortField]))).slice(0, limit); }
  async findInsensitive(kind: "banks" | "cardtypes", field: string, value: string) { return structuredClone(this.values[kind].find((item) => String(item[field]).toLowerCase() === value.toLowerCase()) ?? null); }
  async create(kind: "banks" | "cardtypes", value: MasterRecord) { const created = { ...structuredClone(value), _id: String(this.values[kind].length + 1) }; this.values[kind].push(created); return structuredClone(created); }
  async update(kind: "banks" | "cardtypes", id: string, value: MasterRecord) { const index = this.values[kind].findIndex((item) => String(item._id) === id); if (index < 0) return null; this.values[kind][index] = { ...this.values[kind][index], ...structuredClone(value) }; return structuredClone(this.values[kind][index]); }
  async remove(kind: "banks" | "cardtypes", id: string) { this.values[kind] = this.values[kind].filter((item) => String(item._id) !== id); }
}
