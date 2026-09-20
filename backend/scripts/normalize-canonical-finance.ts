import mongoose from "mongoose";
import { buildCanonicalFinancePlan, type CanonicalAccountRecord, type CanonicalTransactionRecord } from "../src/canonical-finance.js";

const uri = process.env.MONGODB_URI?.trim();
const workspaceId = process.env.FINANCE_MIGRATION_WORKSPACE_ID?.trim();
const mode = process.env.FINANCE_MIGRATION_MODE?.trim() || "dry-run";
const confirmation = process.env.FINANCE_MIGRATION_CONFIRM?.trim();

if (!uri) throw new Error("MONGODB_URI is required");
if (!workspaceId) throw new Error("FINANCE_MIGRATION_WORKSPACE_ID is required");
if (mode !== "dry-run" && mode !== "apply") throw new Error("FINANCE_MIGRATION_MODE must be dry-run or apply");
if (mode === "apply" && confirmation !== "CARD_CREDIT_CANONICAL_FINANCE_V1") {
  throw new Error("FINANCE_MIGRATION_CONFIRM must equal CARD_CREDIT_CANONICAL_FINANCE_V1 for apply mode");
}

await mongoose.connect(uri);
try {
  const db = mongoose.connection.db!;
  const [accounts, transactions] = await Promise.all([
    db.collection("accounts").find({ workspaceId }).project({ _id: 1, type: 1 }).toArray(),
    db.collection("financialtransactions").find({ workspaceId }).project({
      _id: 1,
      accountId: 1,
      accountType: 1,
      transactionType: 1,
      ownership: 1,
      amount: 1,
      reimbursementExpected: 1,
      outstandingReceivable: 1,
      receivableStatus: 1,
      receivableSettledAmount: 1,
      reimbursementForTransactionId: 1,
      voidedAt: 1,
    }).toArray(),
  ]);
  const plan = buildCanonicalFinancePlan(accounts as CanonicalAccountRecord[], transactions as CanonicalTransactionRecord[]);
  const result: Record<string, unknown> = {
    mode,
    database: db.databaseName,
    workspaceId,
    counts: { accounts: accounts.length, transactions: transactions.length },
    plan: {
      accountTypeUpdates: plan.accountTypeUpdates.length,
      receivableUpdates: plan.receivableUpdates.length,
      unresolvedAccountReferences: plan.unresolvedAccountReferences,
      accountTypeSamples: plan.accountTypeUpdates.slice(0, 20),
      receivableSamples: plan.receivableUpdates.slice(0, 20),
    },
  };

  if (mode === "apply" && (plan.accountTypeUpdates.length || plan.receivableUpdates.length)) {
    const transactionCollection = db.collection("financialtransactions");
    const operations = [
      ...plan.accountTypeUpdates.map((update) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(update.transactionId), workspaceId },
          update: { $set: { accountType: update.accountType } },
        },
      })),
      ...plan.receivableUpdates.map((update) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(update.transactionId), workspaceId },
          update: { $set: { outstandingReceivable: update.outstandingReceivable } },
        },
      })),
    ];
    const session = await mongoose.startSession();
    try {
      let writeResult: { matchedCount?: number; modifiedCount?: number } = {};
      await session.withTransaction(async () => {
        writeResult = await transactionCollection.bulkWrite(operations, { ordered: false, session });
      });
      result.write = { matchedCount: writeResult.matchedCount ?? 0, modifiedCount: writeResult.modifiedCount ?? 0 };
    } finally {
      await session.endSession();
    }
  } else {
    result.write = { matchedCount: 0, modifiedCount: 0 };
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await mongoose.disconnect();
}
