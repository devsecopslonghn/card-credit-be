import mongoose from "mongoose";
import { BankModel, CardTypeModel } from "./models/masterdata.js";
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
  private model(kind: "banks" | "cardtypes") { return kind === "banks" ? BankModel : CardTypeModel; }
  async list(kind: "banks" | "cardtypes", sortField: string, limit = MASTERDATA_DEFAULT_LIMIT) { return this.model(kind).find().sort({ [sortField]: 1 }).limit(limit).lean(); }
  async findInsensitive(kind: "banks" | "cardtypes", field: string, value: string) { return this.model(kind).findOne({ [field]: { $regex: `^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }).lean(); }
  async create(kind: "banks" | "cardtypes", value: MasterRecord) { const { _id: _ignored, ...fields } = value; void _ignored; return this.model(kind).create({ ...fields, scope: "GLOBAL" }); }
  async update(kind: "banks" | "cardtypes", id: string, value: MasterRecord) { return this.model(kind).findOneAndUpdate({ _id: new mongoose.Types.ObjectId(id) }, { $set: { ...value } }, { returnDocument: "after", runValidators: true }).lean(); }
  async remove(kind: "banks" | "cardtypes", id: string) { await this.model(kind).deleteOne({ _id: new mongoose.Types.ObjectId(id) }); }
}
export class InMemoryMasterdataRepository implements MasterdataRepository {
  values: Record<"banks" | "cardtypes", MasterRecord[]> = { banks: [], cardtypes: [] };
  async list(kind: "banks" | "cardtypes", sortField: string, limit = MASTERDATA_DEFAULT_LIMIT) { return structuredClone(this.values[kind]).sort((a, b) => String(a[sortField]).localeCompare(String(b[sortField]))).slice(0, limit); }
  async findInsensitive(kind: "banks" | "cardtypes", field: string, value: string) { return structuredClone(this.values[kind].find((item) => String(item[field]).toLowerCase() === value.toLowerCase()) ?? null); }
  async create(kind: "banks" | "cardtypes", value: MasterRecord) { const created = { ...structuredClone(value), _id: String(this.values[kind].length + 1) }; this.values[kind].push(created); return structuredClone(created); }
  async update(kind: "banks" | "cardtypes", id: string, value: MasterRecord) { const index = this.values[kind].findIndex((item) => String(item._id) === id); if (index < 0) return null; this.values[kind][index] = { ...this.values[kind][index], ...structuredClone(value) }; return structuredClone(this.values[kind][index]); }
  async remove(kind: "banks" | "cardtypes", id: string) { this.values[kind] = this.values[kind].filter((item) => String(item._id) !== id); }
}
