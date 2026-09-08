import mongoose from "mongoose";
import { ApiError } from "../errors.js";
import { CalendarSubscriptionModel } from "../models/calendar-subscription.js";
import { createSubscriptionToken, hashSubscriptionToken, normalizeDeviceLabel, serializePaymentDueFeed, validSubscriptionToken } from "../calendar-subscription.js";
import { jobServiceContext } from "../context.js";
import type { AuthRepository } from "../auth-repository.js";
import type { ServiceContext } from "./types/service-context.js";
import { CardQueryService } from "./card-query-service.js";
import { StatementQueryService } from "./statement-query-service.js";

type Data = Record<string, unknown>;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 100;

export type CalendarSubscriptionFeedRepository = {
  findActiveByTokenHash(tokenHash: string): Promise<Data | null>;
  touch(id: unknown): Promise<unknown>;
};

const feedRepository: CalendarSubscriptionFeedRepository = {
  findActiveByTokenHash: async (tokenHash) => CalendarSubscriptionModel.findOne({ tokenHash, revokedAt: null }).select("+tokenHash").lean() as Promise<Data | null>,
  touch: async (id) => CalendarSubscriptionModel.updateOne({ _id: id }, { $set: { lastAccessedAt: new Date() } }),
};

export const safeCalendarSubscription = (doc: Data) => ({
  id: String(doc._id),
  deviceLabel: doc.deviceLabel ?? null,
  createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  lastAccessedAt: doc.lastAccessedAt instanceof Date ? doc.lastAccessedAt.toISOString() : doc.lastAccessedAt ?? null,
  revokedAt: doc.revokedAt instanceof Date ? doc.revokedAt.toISOString() : doc.revokedAt ?? null,
});

const label = (value: unknown) => {
  try {
    return normalizeDeviceLabel(value);
  } catch {
    throw new ApiError(400, "INVALID_DEVICE_LABEL", "Nhãn thiết bị không hợp lệ.", { deviceLabel: "Nhãn tối đa 80 ký tự." });
  }
};

const boundedListLimit = (value: unknown) => Math.min(
  Math.max(Number.parseInt(typeof value === "string" ? value : String(DEFAULT_LIST_LIMIT), 10) || DEFAULT_LIST_LIMIT, 1),
  MAX_LIST_LIMIT,
);

export class CalendarSubscriptionService {
  static async feedContext(token: string, users: Pick<AuthRepository, "findUserById">, requestId: string, subscriptions: CalendarSubscriptionFeedRepository = feedRepository) {
    if (!validSubscriptionToken(token)) return null;
    const subscription = await subscriptions.findActiveByTokenHash(hashSubscriptionToken(token));
    if (!subscription) return null;
    const user = await users.findUserById(String(subscription.userId));
    if (!user || !user.active || user.lockedAt || user.workspaceId !== subscription.workspaceId) return null;
    const context = jobServiceContext({ userId: user.id, workspaceId: user.workspaceId, role: user.role }, requestId);
    void subscriptions.touch(subscription._id).catch(() => {});
    return context;
  }

  static async list(ctx: ServiceContext, rawLimit?: unknown) {
    const limit = boundedListLimit(rawLimit);
    const docs = await CalendarSubscriptionModel.find({ userId: ctx.userId, workspaceId: ctx.workspaceId }).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map((doc) => safeCalendarSubscription(doc as Data));
  }

  static async create(ctx: ServiceContext, deviceLabel: unknown) {
    const token = createSubscriptionToken();
    const doc = await CalendarSubscriptionModel.create({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      deviceLabel: label(deviceLabel),
      tokenHash: hashSubscriptionToken(token),
    });
    return {
      ...safeCalendarSubscription(doc.toObject() as Data),
      subscriptionPath: `/api/calendar-subscriptions/feed/${token}.ics`,
    };
  }

  static async revoke(ctx: ServiceContext, id: string) {
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Không tìm thấy lịch đăng ký.");
    const result = await CalendarSubscriptionModel.updateOne(
      { _id: id, userId: ctx.userId, workspaceId: ctx.workspaceId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    if (!result.modifiedCount) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Không tìm thấy lịch đăng ký.");
    return { revoked: true };
  }

  static async feed(ctx: ServiceContext) {
    const cards = await CardQueryService.list(ctx, { userId: ctx.userId });
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const statements = await StatementQueryService.listForCardIds(ctx, cards.map((card) => card.id), { unpaidOnly: true, order: "paymentDueDate" });
    const inputs = statements.flatMap((statement) => {
      const card = cardById.get(statement.cardId);
      if (!card) return [];
      return [{ identity: `${ctx.workspaceId}/${ctx.userId}/${statement.id}`, displayName: card.displayName ?? "Thẻ tín dụng", providerName: card.providerName ?? "Ngân hàng", owner: card.owner, periodStartDate: statement.periodStartDate, periodEndDate: statement.periodEndDate, statementDate: statement.statementDate, paymentDueDate: statement.paymentDueDate, totalAmountDue: statement.summary.outstandingAmount, effectivePaymentStatus: statement.effectivePaymentStatus, timezone: card.reminderTimezone ?? "Asia/Ho_Chi_Minh" }];
    });
    return serializePaymentDueFeed(inputs);
  }
}
