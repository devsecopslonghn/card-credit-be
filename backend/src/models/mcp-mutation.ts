import mongoose, { Schema } from "mongoose";

const schema = new Schema({
  workspaceId: { type: String, required: true },
  userId: { type: String, required: true },
  operation: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  payloadHash: { type: String, required: true },
  result: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true });
schema.index({ workspaceId: 1, operation: 1, idempotencyKey: 1 }, { unique: true });
export const McpMutationModel = (mongoose.models.McpMutation ?? mongoose.model("McpMutation", schema)) as mongoose.Model<Record<string, unknown>>;
