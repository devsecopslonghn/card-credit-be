import mongoose, { Schema } from "mongoose";
import type { ServiceChannel } from "../services/types/service-context.js";

// Expiry is derived from expiresAt; no separate terminal EXPIRED write is
// performed inside the command transaction.
export type CommandPreviewStatus = "ISSUED" | "CONSUMED";
export type CommandPreviewDocument = {
  _id?: unknown;
  workspaceId: string;
  userId: string;
  channel: ServiceChannel;
  operation: string;
  previewId: string;
  payloadHash: string;
  tokenHash: string;
  status: CommandPreviewStatus;
  expiresAt: Date;
  consumedAt?: Date | null;
  createdAt?: Date;
};

const CommandPreviewSchema = new Schema<CommandPreviewDocument>({
  workspaceId: { type: String, required: true },
  userId: { type: String, required: true },
  channel: { type: String, enum: ["browser", "mcp", "job"], required: true },
  operation: { type: String, required: true },
  previewId: { type: String, required: true },
  payloadHash: { type: String, required: true },
  tokenHash: { type: String, required: true },
  status: { type: String, enum: ["ISSUED", "CONSUMED"], required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

CommandPreviewSchema.index({ workspaceId: 1, previewId: 1 }, { name: "command_preview_unique", unique: true });
CommandPreviewSchema.index({ workspaceId: 1, tokenHash: 1 }, { name: "command_preview_token_unique", unique: true });
CommandPreviewSchema.index({ workspaceId: 1, createdAt: -1 }, { name: "command_preview_workspace_created" });
CommandPreviewSchema.index({ workspaceId: 1, status: 1, expiresAt: 1 }, { name: "command_preview_expiry" });

export const CommandPreviewModel = (mongoose.models.CommandPreview ?? mongoose.model<CommandPreviewDocument>("CommandPreview", CommandPreviewSchema, "commandpreviews"));
