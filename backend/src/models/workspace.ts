import mongoose, { Schema } from "mongoose";
const WorkspaceSchema = new Schema({ workspaceId: { type: String, required: true, unique: true }, ownerUserId: { type: String, default: null } }, { timestamps: true });
export const WorkspaceModel = (mongoose.models.Workspace ?? mongoose.model("Workspace", WorkspaceSchema)) as mongoose.Model<Record<string, unknown>>;
