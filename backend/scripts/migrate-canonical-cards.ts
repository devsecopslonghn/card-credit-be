import mongoose from "mongoose";
import { readCatalogFile, catalogPath } from "../src/catalog-sync.js";
import { CreditCardModel } from "../src/models/credit-card.js";

const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("MONGODB_URI is required");
const apply = process.argv.includes("--apply");
const unsetLegacy = { legacy: "", bank: "", name: "", type: "", monthlyData: "", statementDate: "", paymentDueDate: "", amountDueThisMonth: "", isPaidThisMonth: "" };

const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const matchProduct = (card: Record<string, unknown>, products: Awaited<ReturnType<typeof readCatalogFile>>) => {
  const provider = normalize(card.providerCode ?? card.bank);
  const name = normalize(card.displayName ?? card.name);
  const matches = products.filter((product) => normalize(product.providerCode) === provider && normalize(product.displayName) === name);
  return matches.length === 1 ? matches[0] : null;
};

await mongoose.connect(uri);
try {
  const products = await readCatalogFile(catalogPath());
  const cards = await CreditCardModel.collection.find({}).toArray() as Array<Record<string, unknown>>;
  const candidates: Array<{ card: Record<string, unknown>; presetId: string; workspaceId: string }> = [];
  const unresolved: Array<{ id: string; reason: string }> = [];
  for (const card of cards) {
    const workspaceId = typeof card.workspaceId === "string" ? card.workspaceId.trim() : "";
    if (!workspaceId) {
      unresolved.push({ id: String(card._id), reason: "workspaceId-missing" });
      continue;
    }
    const product = typeof card.presetId === "string" ? products.find((candidate) => candidate.presetId === card.presetId) : matchProduct(card, products);
    if (!product) {
      unresolved.push({ id: String(card._id), reason: typeof card.presetId === "string" ? "presetId-not-in-catalog" : "legacy-fields-did-not-match-one-catalog-product" });
      continue;
    }
    candidates.push({ card, presetId: product.presetId, workspaceId });
  }
  if (apply && !unresolved.length) {
    for (const { card, presetId, workspaceId } of candidates) {
      const product = products.find((candidate) => candidate.presetId === presetId)!;
      await CreditCardModel.collection.updateOne({ _id: card._id as mongoose.Types.ObjectId }, { $set: { workspaceId, presetId: product.presetId, providerCode: product.providerCode, providerName: product.providerName, displayName: product.displayName, network: product.network, catalogVersion: "mongodb-v1" }, $unset: unsetLegacy });
    }
  }
  console.log(JSON.stringify({ mode: apply ? (unresolved.length ? "blocked" : "apply") : "dry-run", total: cards.length, candidates: candidates.length, migrated: apply && !unresolved.length ? candidates.length : 0, unresolved, migratedCards: candidates.map(({ card, presetId }) => ({ id: String(card._id), presetId })) }));
  if (unresolved.length) process.exitCode = 2;
} finally {
  await mongoose.disconnect();
}
