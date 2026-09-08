import mongoose, { Schema } from "mongoose";
import type { ServiceChannel } from "../services/types/service-context.js";

export type CommandAuditOutcome = "SUCCESS" | "FAILURE";
export type CommandAuditDocument = {
  _id?: unknown;
  workspaceId: string;
  userId: string;
  channel: ServiceChannel;
  correlationId: string;
  operation: string;
  endpointOrTool: string;
  previewId?: string | null;
  resource?: Record<string, unknown> | null;
  outcome: CommandAuditOutcome;
  errorCode?: string | null;
  createdAt?: Date;
};

const CommandAuditSchema = new Schema<CommandAuditDocument>({
  workspaceId: { type: String, required: true },
  userId: { type: String, required: true },
  channel: { type: String, enum: ["browser", "mcp", "job"], required: true },
  correlationId: { type: String, required: true },
  operation: { type: String, required: true },
  endpointOrTool: { type: String, required: true },
  previewId: { type: String, default: null },
  resource: { type: Schema.Types.Mixed, default: null },
  outcome: { type: String, enum: ["SUCCESS", "FAILURE"], required: true },
  errorCode: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

CommandAuditSchema.index({ workspaceId: 1, createdAt: -1 }, { name: "command_audit_workspace_created" });
CommandAuditSchema.index({ workspaceId: 1, operation: 1, createdAt: -1 }, { name: "command_audit_workspace_operation_created" });

export const CommandAuditModel = (mongoose.models.CommandAudit ?? mongoose.model<CommandAuditDocument>("CommandAudit", CommandAuditSchema, "commandaudits"));
