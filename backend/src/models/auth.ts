import mongoose, { Schema } from "mongoose";

const AuthUserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["admin", "user"], required: true },
  workspaceId: { type: String, required: true, index: true },
  displayName: { type: String, required: true, maxlength: 120 },
  active: { type: Boolean, default: true, index: true },
  lockedAt: { type: Date, default: null },
  sessionVersion: { type: Number, default: 0, min: 0 },
  lastLoginAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
}, { timestamps: true, collection: "users" });
AuthUserSchema.index({ workspaceId: 1, email: 1 });

const PasswordResetTokenSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true, select: false },
  userId: { type: String, required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  expiresAt: { type: Date, required: true, index: true },
  usedAt: { type: Date, default: null },
}, { timestamps: true, collection: "passwordresettokens" });
PasswordResetTokenSchema.index({ userId: 1, usedAt: 1, expiresAt: 1 });

const AuthAuditLogSchema = new Schema({
  event: { type: String, required: true, index: true },
  userId: { type: String, default: null, index: true },
  email: { type: String, default: null, index: true },
  role: { type: String, enum: ["admin", "user", null], default: null },
  workspaceId: { type: String, default: null, index: true },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  correlationId: { type: String, default: null },
  resource: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: "authauditlogs" });
AuthAuditLogSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
AuthAuditLogSchema.index({ event: 1, createdAt: -1, _id: -1 });

export const AuthUserModel = (mongoose.models.AuthUser ?? mongoose.model("AuthUser", AuthUserSchema)) as mongoose.Model<Record<string, unknown>>;
export const PasswordResetTokenModel = (mongoose.models.PasswordResetToken ?? mongoose.model("PasswordResetToken", PasswordResetTokenSchema)) as mongoose.Model<Record<string, unknown>>;
export const AuthAuditLogModel = (mongoose.models.AuthAuditLog ?? mongoose.model("AuthAuditLog", AuthAuditLogSchema)) as mongoose.Model<Record<string, unknown>>;
