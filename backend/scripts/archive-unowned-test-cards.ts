import mongoose from "mongoose";
import { CreditCardArchiveModel } from "../src/models/credit-card-archive.js";
import { CreditCardModel } from "../src/models/credit-card.js";

const uri = process.env.MONGODB_URI?.trim();
if (!uri) throw new Error("MONGODB_URI is required");

const apply = process.argv.includes("--apply");
if (apply && process.env.CARD_TEST_CLEANUP_ALLOW !== "true") {
  throw new Error("CARD_TEST_CLEANUP_ALLOW=true is required for archive writes");
}

const targets = [
  { id: "6a495e94c9cc2a2dd42e5837", displayName: "Platinum American Express®" },
  { id: "6a495ed6c9cc2a2dd42e58bc", displayName: "Visa Platinum Cashback" },
  { id: "6a49cf6211ec2e677ae60bd7", displayName: "One" },
  { id: "6a49cf7011ec2e677ae60c08", displayName: "Max Card" },
] as const;

const sourceCollection = "creditcards";
const reason = "TEST_DATA_UNOWNED";
const objectIds = targets.map(({ id }) => new mongoose.Types.ObjectId(id));
const archiveKey = (id: string) => `${sourceCollection}:${id}`;
const nonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0;

type CardDocument = Record<string, unknown> & { _id: mongoose.Types.ObjectId };

const referenceCounts = async (id: mongoose.Types.ObjectId) => {
  const [statements, cashbacks, fees, accounts] = await Promise.all([
    mongoose.connection.db!.collection("cardstatements").countDocuments({ userCardId: id }),
    mongoose.connection.db!.collection("monthlycardcashbacks").countDocuments({ userCardId: id }),
    mongoose.connection.db!.collection("cardfeepayments").countDocuments({ userCardId: id }),
    mongoose.connection.db!.collection("accounts").countDocuments({ creditCardId: id }),
  ]);
  return { statements, cashbacks, fees, accounts };
};

const ensureArchiveKeyIndex = async () => {
  const collection = CreditCardArchiveModel.collection;
  const indexes = await collection.listIndexes().toArray();
  const existing = indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ archiveKey: 1 }));
  if (existing?.unique !== true) {
    if (existing) throw new Error("creditcardarchives has a non-unique archiveKey index");
    await collection.createIndex({ archiveKey: 1 }, { unique: true });
  }
};

await mongoose.connect(uri);
try {
  const cards = await CreditCardModel.collection.find({ _id: { $in: objectIds } }).toArray() as CardDocument[];
  const archives = await CreditCardArchiveModel.find({
    archiveKey: { $in: targets.map(({ id }) => archiveKey(id)) },
  }).lean() as Array<Record<string, unknown>>;
  const cardsById = new Map(cards.map((card) => [String(card._id), card]));
  const archivesByKey = new Map(archives.map((archive) => [String(archive.archiveKey), archive]));
  const unresolved: Array<{ id: string; reason: string }> = [];
  const candidates: Array<{ target: (typeof targets)[number]; card: CardDocument; references: Awaited<ReturnType<typeof referenceCounts>> }> = [];
  const alreadyArchived: string[] = [];

  for (const target of targets) {
    const archived = archivesByKey.get(archiveKey(target.id));
    const card = cardsById.get(target.id);
    if (archived && !card) {
      alreadyArchived.push(target.id);
      continue;
    }
    if (!card) {
      unresolved.push({ id: target.id, reason: "target-card-missing-without-archive" });
      continue;
    }
    if (archived) {
      unresolved.push({ id: target.id, reason: "archive-exists-while-source-card-still-exists" });
      continue;
    }
    if (nonEmptyString(card.workspaceId) || nonEmptyString(card.userId)) {
      unresolved.push({ id: target.id, reason: "card-has-owner-or-workspace" });
      continue;
    }
    const persistedDisplayName = nonEmptyString(card.displayName) ? card.displayName : card.name;
    if (persistedDisplayName !== target.displayName) {
      unresolved.push({ id: target.id, reason: "display-name-does-not-match-reviewed-target" });
      continue;
    }
    const references = await referenceCounts(card._id);
    if (Object.values(references).some((count) => count > 0)) {
      unresolved.push({ id: target.id, reason: `card-has-references:${JSON.stringify(references)}` });
      continue;
    }
    candidates.push({ target, card, references });
  }

  if (apply && unresolved.length) {
    throw new Error(`Refusing archive because preflight is unresolved: ${JSON.stringify(unresolved)}`);
  }

  if (apply && candidates.length) {
    await ensureArchiveKeyIndex();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const archivedAt = new Date();
        await CreditCardArchiveModel.bulkWrite(candidates.map(({ target, card }) => ({
          updateOne: {
            filter: { archiveKey: archiveKey(target.id) },
            update: {
              $setOnInsert: {
                archiveKey: archiveKey(target.id),
                sourceCollection,
                sourceId: card._id,
                reason,
                archivedAt,
                original: card,
              },
            },
            upsert: true,
          },
        })), { session });

        const archivedCount = await CreditCardArchiveModel.countDocuments({
          archiveKey: { $in: candidates.map(({ target }) => archiveKey(target.id)) },
        }).session(session);
        if (archivedCount !== candidates.length) throw new Error("Archive verification failed");

        const deleted = await CreditCardModel.collection.deleteMany(
          { _id: { $in: candidates.map(({ card }) => card._id) } },
          { session },
        );
        if (deleted.deletedCount !== candidates.length) throw new Error("Source cleanup verification failed");
      });
    } finally {
      await session.endSession();
    }
  }

  const mode = apply ? "apply" : alreadyArchived.length === targets.length ? "already-archived" : "dry-run";
  console.log(JSON.stringify({
    mode,
    sourceCollection,
    archiveCollection: "creditcardarchives",
    reason,
    targetCount: targets.length,
    candidateCount: candidates.length,
    archivedCount: apply ? candidates.length + alreadyArchived.length : alreadyArchived.length,
    unresolved,
    candidates: candidates.map(({ target, references }) => ({ id: target.id, displayName: target.displayName, references })),
    alreadyArchived,
  }));
  if (unresolved.length) process.exitCode = 2;
} finally {
  await mongoose.disconnect();
}
