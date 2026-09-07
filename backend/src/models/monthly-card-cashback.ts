import mongoose, { Schema } from "mongoose";

const MonthlyCardCashbackSchema = new Schema(
  {
    workspaceId: { type: String, required: true },
    userId: { type: String, required: true },
    userCardId: {
      type: Schema.Types.ObjectId,
      ref: "CreditCard",
      required: true,
    },
    period: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },
    expectedAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    actualAmount: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (value: unknown) =>
          value === null || Number.isSafeInteger(value),
        message: "actualAmount must be an integer",
      },
    },
    status: {
      type: String,
      enum: ["PENDING", "RECEIVED", "REJECTED"],
      default: "PENDING",
    },
    receivedAt: { type: Date, default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

MonthlyCardCashbackSchema.index(
  { workspaceId: 1, userCardId: 1, period: 1 },
  { unique: true },
);
MonthlyCardCashbackSchema.index({
  workspaceId: 1,
  period: -1,
});

export const MonthlyCardCashbackModel = (mongoose.models.MonthlyCardCashback ??
  mongoose.model(
    "MonthlyCardCashback",
    MonthlyCardCashbackSchema,
  )) as mongoose.Model<Record<string, unknown>>;
