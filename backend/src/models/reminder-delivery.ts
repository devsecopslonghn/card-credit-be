import mongoose, { Schema } from "mongoose";
const ReminderDeliverySchema = new Schema({
  workspaceId: { type: String, required: true }, cardId: { type: Schema.Types.ObjectId, required: true }, statementId: { type: Schema.Types.ObjectId, required: true }, daysBefore: { type: Number, required: true },
  status: { type: String, enum: ["PENDING", "CLAIMED", "SENT", "FAILED", "SKIPPED"], default: "PENDING" }, attemptCount: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: null }, claimedAt: { type: Date, default: null }, sentAt: { type: Date, default: null }, failureCode: { type: String, default: null },
}, { timestamps: true });
ReminderDeliverySchema.index({ workspaceId: 1, statementId: 1, daysBefore: 1 }, { unique: true });
ReminderDeliverySchema.index({ status: 1, nextAttemptAt: 1, claimedAt: 1 });
export const ReminderDeliveryModel = (mongoose.models.ReminderDelivery ?? mongoose.model("ReminderDelivery", ReminderDeliverySchema)) as mongoose.Model<Record<string, unknown>>;
