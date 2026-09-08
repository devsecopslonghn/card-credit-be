import mongoose from "mongoose";
import {
  feeCategorySchema,
  feeCenterRecordListSchema,
  feeCardSummarySchema,
  feePaymentListSchema,
  feePaymentSchema,
  type FeeCategory,
  type FeeCenterRecordDto,
  type FeePaymentDto,
  type CardDto,
} from "@card-credit/contracts";
import { ApiError } from "../errors.js";
import { CardFeePaymentModel } from "../models/card-fee-payment.js";
import { CardQueryService } from "./card-query-service.js";
import type { ServiceContext } from "./types/service-context.js";
import { idOf, plain } from "../statement-domain.js";
import { boundedReadLimit } from "../read-limits.js";

const validCardId = (cardId: string) => {
  if (!mongoose.isValidObjectId(cardId)) throw new ApiError(400, "INVALID_CARD_ID", "Card id không hợp lệ.");
};

const feeDtoFromDocument = (value: unknown): FeePaymentDto => {
  const item = plain(value);
  return feePaymentSchema.parse({
    id: idOf(item._id ?? item.id),
    cardId: idOf(item.userCardId ?? item.cardId),
    category: item.category ?? "ANNUAL_CARD_FEE",
    paymentDate: String(item.paymentDate ?? ""),
    amount: Number(item.amount ?? 0),
    note: String(item.note ?? ""),
  }) as FeePaymentDto;
};

const cardSummary = (card: CardDto) => feeCardSummarySchema.parse({
  id: card.id,
  providerName: card.providerName,
  displayName: card.displayName,
  owner: card.owner,
});

export class FeeQueryService {
  static async listCardPayments(ctx: ServiceContext, cardId: string, rawLimit?: unknown): Promise<FeePaymentDto[]> {
    validCardId(cardId);
    await CardQueryService.get(ctx, cardId);
    const records = await CardFeePaymentModel.find({ workspaceId: ctx.workspaceId, userCardId: cardId })
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(boundedReadLimit(rawLimit))
      .lean();
    return feePaymentListSchema.parse(records.map(feeDtoFromDocument)) as FeePaymentDto[];
  }

  static async listCenter(ctx: ServiceContext, options: { cardId?: string; category?: FeeCategory } = {}, rawLimit?: unknown): Promise<FeeCenterRecordDto[]> {
    const card = options.cardId ? await CardQueryService.get(ctx, options.cardId) : null;
    const category = options.category ? feeCategorySchema.parse(options.category) : undefined;
    const query: Record<string, unknown> = {
      workspaceId: ctx.workspaceId,
      ...(card ? { userCardId: card.id } : {}),
      ...(category ? { category } : {}),
    };
    const [records, cards] = await Promise.all([
      CardFeePaymentModel.find(query).sort({ paymentDate: -1, createdAt: -1 }).limit(boundedReadLimit(rawLimit)).lean(),
      CardQueryService.list(ctx, {}, rawLimit),
    ]);
    const cardsById = new Map(cards.map((item) => [item.id, cardSummary(item)]));
    return feeCenterRecordListSchema.parse(records.map((record) => {
      const payment = feeDtoFromDocument(record);
      return { ...payment, card: cardsById.get(payment.cardId) ?? null };
    })) as FeeCenterRecordDto[];
  }
}
