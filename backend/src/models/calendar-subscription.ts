import mongoose, { Schema } from "mongoose";

const CalendarSubscriptionSchema = new Schema({
  userId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true, index: true },
  deviceLabel: { type: String, default: null },
  tokenHash: { type: String, required: true, unique: true, select: false },
  revokedAt: { type: Date, default: null },
  lastAccessedAt: { type: Date, default: null },
}, { timestamps: true });
CalendarSubscriptionSchema.index({ userId: 1, workspaceId: 1, createdAt: -1 });
CalendarSubscriptionSchema.index(
  { userId: 1, workspaceId: 1, deviceLabel: 1 },
  {
    name: "calendar_subscription_user_workspace_device_unique",
    unique: true,
    partialFilterExpression: { deviceLabel: { $type: "string" } },
  },
);
export const CalendarSubscriptionModel = (mongoose.models.CalendarSubscription ?? mongoose.model("CalendarSubscription", CalendarSubscriptionSchema)) as mongoose.Model<Record<string, unknown>>;
