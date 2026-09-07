import mongoose, { Schema } from "mongoose";
import type { ServiceChannel } from "../services/types/service-context.js";

export type CommandReceiptStatus = "PENDING" | "COMPLETED" | "FAILED";
export type CommandReceiptDocument = {
  _id?: unknown;
  workspaceId: string;
  userId: string;
  channel: ServiceChannel;
  operation: string;
  idempotencyKey: string;
  payloadHash: string;
  status: CommandReceiptStatus;
  result?: unknown;
  errorCode?: string | null;
  createdAt?: Date;
  completedAt?: Date | null;
};

const CommandReceiptSchema = new Schema<CommandReceiptDocument>({
  workspaceId: { type: String, required: true },
  userId: { type: String, required: true },
  channel: { type: String, enum: ["browser", "mcp", "job"], required: true },
  operation: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  payloadHash: { type: String, required: true },
  status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED"], required: true },
  result: { type: Schema.Types.Mixed },
  errorCode: { type: String, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

CommandReceiptSchema.index({ workspaceId: 1, operation: 1, idempotencyKey: 1 }, { name: "command_receipt_unique", unique: true });
CommandReceiptSchema.index({ workspaceId: 1, createdAt: -1 }, { name: "command_receipt_workspace_created" });

export const CommandReceiptModel = (mongoose.models.CommandReceipt ?? mongoose.model<CommandReceiptDocument>("CommandReceipt", CommandReceiptSchema, "commandreceipts"));
