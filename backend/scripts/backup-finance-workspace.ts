import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI?.trim();
const workspaceId = process.env.FINANCE_MIGRATION_WORKSPACE_ID?.trim();
const outputDir = process.env.FINANCE_BACKUP_DIR?.trim() || path.resolve("backups");
if (!uri) throw new Error("MONGODB_URI is required");
if (!workspaceId) throw new Error("FINANCE_MIGRATION_WORKSPACE_ID is required");
await mongoose.connect(uri);
try {
  const db = mongoose.connection.db!;
  const collections = await db.listCollections().toArray();
  const selected = collections.map((item) => item.name).filter((name) => !name.startsWith("system."));
  const backup = { backupVersion: 1, createdAt: new Date().toISOString(), workspaceId, collections: {} as Record<string, unknown[]> };
  for (const name of selected) backup.collections[name] = await db.collection(name).find({ workspaceId }).toArray();
  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, `finance-${workspaceId}-${new Date().toISOString().replaceAll(":", "-")}.json`);
  await fs.writeFile(file, JSON.stringify(backup, (_, value) => value?._bsontype ? { $type: value._bsontype, $value: value.toString() } : value, 2), { mode: 0o600 });
  console.log(JSON.stringify({ file, workspaceId, collections: Object.fromEntries(Object.entries(backup.collections).map(([name, rows]) => [name, rows.length])) }));
} finally { await mongoose.disconnect(); }
