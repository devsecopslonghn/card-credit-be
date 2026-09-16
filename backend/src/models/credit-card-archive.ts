import mongoose, { Schema } from "mongoose";

const CreditCardArchiveSchema = new Schema(
  {
    archiveKey: { type: String, required: true, unique: true },
    sourceCollection: { type: String, required: true, enum: ["creditcards"] },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, required: true, enum: ["TEST_DATA_UNOWNED"] },
    archivedAt: { type: Date, required: true },
    original: { type: Schema.Types.Mixed, required: true },
  },
  { collection: "creditcardarchives", versionKey: false },
);

CreditCardArchiveSchema.index(
  { sourceCollection: 1, sourceId: 1 },
  { unique: true, name: "credit_card_archive_source_unique" },
);

export const CreditCardArchiveModel = (mongoose.models.CreditCardArchive ??
  mongoose.model("CreditCardArchive", CreditCardArchiveSchema)) as mongoose.Model<
  Record<string, unknown>
>;
