import mongoose from "mongoose";
import { cardDuplicateGroupListSchema, cardPortfolioCardSchema, type CardDto, type CardDuplicateGroupDto } from "@card-credit/contracts";
import { ApiError } from "../errors.js";
import { CreditCardModel } from "../models/credit-card.js";
import { idOf, plain } from "../statement-domain.js";
import type { ServiceContext } from "./types/service-context.js";
import { duplicateFingerprint, duplicateReason, normalizeDuplicateOwner } from "../card-duplicate.js";
import { boundedReadLimit } from "../read-limits.js";

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const nullableCashbackPeriod = (value: unknown): CardDto["cashbackCapPeriod"] => value === "STATEMENT" || value === "CALENDAR_MONTH" ? value : null;
const monthlyData = (value: unknown): CardDto["monthlyData"] => Array.isArray(value)
  ? value.map((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      month: Number(source.month),
      spend: Number(source.spend ?? 0),
      cashback: Number(source.cashback ?? 0),
      fee: Number(source.fee ?? 0),
      otherInterest: Number(source.otherInterest ?? 0),
    };
  }).filter((item) => Number.isInteger(item.month) && item.month >= 1 && item.month <= 12)
  : [];

export const cardDtoFromDocument = (value: unknown): CardDto => {
  const card = plain(value);
  return cardPortfolioCardSchema.parse({
    id: idOf(card._id ?? card.id),
    presetId: stringOrNull(card.presetId),
    providerCode: stringOrNull(card.providerCode ?? card.bank),
    providerName: stringOrNull(card.providerName ?? card.bank),
    displayName: stringOrNull(card.displayName ?? card.name),
    network: stringOrNull(card.network ?? card.type),
    legacy: typeof card.legacy === "boolean" ? card.legacy : !card.presetId,
    owner: typeof card.owner === "string" && card.owner.trim() ? card.owner.trim() : "Tôi",
    imageUrl: stringOrNull(card.imageUrl),
    annualFee: numberOrNull(card.annualFee),
    targetSpendForWaiver: numberOrNull(card.targetSpendForWaiver),
    annualFeeWaiverTarget: numberOrNull(card.annualFeeWaiverTarget),
    statementDay: numberOrNull(card.statementDay),
    paymentDueDays: numberOrNull(card.paymentDueDays),
    cashbackCapAmount: numberOrNull(card.cashbackCapAmount),
    cashbackCapPeriod: nullableCashbackPeriod(card.cashbackCapPeriod),
    active: card.active !== false,
    reminderEnabled: card.reminderEnabled !== false,
    reminderDaysBefore: Array.isArray(card.reminderDaysBefore) ? card.reminderDaysBefore.filter((item): item is number => typeof item === "number" && Number.isInteger(item)) : [],
    reminderTimezone: stringOrNull(card.reminderTimezone),
    reminderTime: stringOrNull(card.reminderTime),
    statementDate: stringOrNull(card.statementDate),
    paymentDueDate: stringOrNull(card.paymentDueDate),
    amountDueThisMonth: numberOrNull(card.amountDueThisMonth),
    isPaidThisMonth: typeof card.isPaidThisMonth === "boolean" ? card.isPaidThisMonth : null,
    monthlyData: monthlyData(card.monthlyData),
  }) as CardDto;
};

const validId = (id: string) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "INVALID_CARD_ID", "Card id không hợp lệ.");
};

export class CardQueryService {
  static async list(ctx: ServiceContext, options: { activeOnly?: boolean; userId?: string } = {}, rawLimit?: unknown): Promise<CardDto[]> {
    const query = { workspaceId: ctx.workspaceId, ...(options.userId ? { userId: options.userId } : {}), active: { $ne: false }, ...(options.activeOnly ? { active: { $ne: false } } : {}) };
    const cards = await CreditCardModel.find(query).sort({ createdAt: -1 }).limit(boundedReadLimit(rawLimit)).lean();
    return cards.map(cardDtoFromDocument);
  }

  static async get(ctx: ServiceContext, cardId: string): Promise<CardDto> {
    validId(cardId);
    const card = await CreditCardModel.findOne({ _id: cardId, workspaceId: ctx.workspaceId }).lean();
    if (!card) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    return cardDtoFromDocument(card);
  }

 static async compare(ctx: ServiceContext, rawLimit?: unknown): Promise<CardDto[]> {
   return this.list(ctx, { activeOnly: true }, rawLimit);
 }

  static async listDuplicates(ctx: ServiceContext, rawLimit?: unknown): Promise<CardDuplicateGroupDto[]> {
    const cards = await CreditCardModel.find({ workspaceId: ctx.workspaceId, active: { $ne: false } }).sort({ createdAt: 1 }).limit(boundedReadLimit(rawLimit)).lean();
    const groups = new Map<string, { fingerprint: string; presetId: string; normalizedOwner: string; reason: string; cards: CardDto[] }>();
    for (const raw of cards) {
      const fingerprint = duplicateFingerprint(raw as Record<string, unknown>);
      const normalizedOwner = normalizeDuplicateOwner(raw.owner);
      if (!fingerprint || typeof raw.presetId !== "string" || !normalizedOwner) continue;
      const group = groups.get(fingerprint) ?? {
        fingerprint,
        presetId: raw.presetId,
        normalizedOwner,
        reason: duplicateReason,
        cards: [],
      };
      group.cards.push(cardDtoFromDocument(raw));
      groups.set(fingerprint, group);
    }
    return cardDuplicateGroupListSchema.parse([...groups.values()].filter((group) => group.cards.length > 1)) as CardDuplicateGroupDto[];
  }
}
