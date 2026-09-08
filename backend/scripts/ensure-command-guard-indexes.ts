import mongoose from "mongoose";

const uri = process.env.MONGODB_URI?.trim();
const apply = process.env.COMMAND_GUARD_INDEX_APPLY === "true";
if (!uri) throw new Error("MONGODB_URI is required");

await mongoose.connect(uri);
try {
  const db = mongoose.connection.db!;
  const receipts = db.collection("commandreceipts");
  const audits = db.collection("commandaudits");
  const previews = db.collection("commandpreviews");
  const [receiptIndexes, auditIndexes, previewIndexes, duplicateReceipts, duplicatePreviews, duplicatePreviewTokens] = await Promise.all([
    receipts.indexes().catch(() => []),
    audits.indexes().catch(() => []),
    previews.indexes().catch(() => []),
    receipts.aggregate([
      { $group: { _id: { workspaceId: "$workspaceId", operation: "$operation", idempotencyKey: "$idempotencyKey" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "groups" },
    ]).toArray().catch(() => []),
    previews.aggregate([
      { $group: { _id: { workspaceId: "$workspaceId", previewId: "$previewId" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "groups" },
    ]).toArray().catch(() => []),
    previews.aggregate([
      { $group: { _id: { workspaceId: "$workspaceId", tokenHash: "$tokenHash" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: "groups" },
    ]).toArray().catch(() => []),
  ]);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    collections: { commandreceipts: await db.listCollections({ name: "commandreceipts" }).hasNext(), commandaudits: await db.listCollections({ name: "commandaudits" }).hasNext(), commandpreviews: await db.listCollections({ name: "commandpreviews" }).hasNext() },
    receiptIndexes: receiptIndexes.map((index) => index.name),
    auditIndexes: auditIndexes.map((index) => index.name),
    previewIndexes: previewIndexes.map((index) => index.name),
    duplicateReceiptGroups: duplicateReceipts[0]?.groups ?? 0,
    duplicatePreviewGroups: duplicatePreviews[0]?.groups ?? 0,
    duplicatePreviewTokenGroups: duplicatePreviewTokens[0]?.groups ?? 0,
  }));
  if (apply) {
    if ((duplicateReceipts[0]?.groups ?? 0) > 0) throw new Error("Cannot apply command receipt indexes while duplicate keys exist");
    if ((duplicatePreviews[0]?.groups ?? 0) > 0 || (duplicatePreviewTokens[0]?.groups ?? 0) > 0) throw new Error("Cannot apply command preview indexes while duplicate keys exist");
    await receipts.createIndex({ workspaceId: 1, operation: 1, idempotencyKey: 1 }, { name: "command_receipt_unique", unique: true });
    await receipts.createIndex({ workspaceId: 1, createdAt: -1 }, { name: "command_receipt_workspace_created" });
    await audits.createIndex({ workspaceId: 1, createdAt: -1 }, { name: "command_audit_workspace_created" });
    await audits.createIndex({ workspaceId: 1, operation: 1, createdAt: -1 }, { name: "command_audit_workspace_operation_created" });
    await previews.createIndex({ workspaceId: 1, previewId: 1 }, { name: "command_preview_unique", unique: true });
    await previews.createIndex({ workspaceId: 1, tokenHash: 1 }, { name: "command_preview_token_unique", unique: true });
    await previews.createIndex({ workspaceId: 1, createdAt: -1 }, { name: "command_preview_workspace_created" });
    await previews.createIndex({ workspaceId: 1, status: 1, expiresAt: 1 }, { name: "command_preview_expiry" });
    const required = new Set(["command_receipt_unique", "command_receipt_workspace_created", "command_audit_workspace_created", "command_audit_workspace_operation_created", "command_preview_unique", "command_preview_token_unique", "command_preview_workspace_created", "command_preview_expiry"]);
    const verified = new Set([
      ...(await receipts.indexes()).map((index) => index.name),
      ...(await audits.indexes()).map((index) => index.name),
      ...(await previews.indexes()).map((index) => index.name),
    ]);
    const missing = [...required].filter((name) => !verified.has(name));
    if (missing.length) throw new Error(`Command guard index verification failed: ${missing.join(",")}`);
    console.log(JSON.stringify({ applied: true, verified: [...required] }));
  }
} finally {
  await mongoose.disconnect();
}
