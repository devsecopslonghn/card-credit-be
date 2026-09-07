import mongoose from "mongoose";
import { ApiError } from "../errors.js";
import { CreditCardModel } from "../models/credit-card.js";
import { AccountModel } from "../models/account.js";
import { CardStatementModel } from "../models/card-statement.js";
import { MonthlyCardCashbackModel } from "../models/monthly-card-cashback.js";
import { CardFeePaymentModel } from "../models/card-fee-payment.js";
import { duplicateFingerprint } from "../card-duplicate.js";
import { cardDtoFromDocument } from "./card-query-service.js";
import type { CardDto } from "@card-credit/contracts";
import type { ServiceContext } from "./types/service-context.js";

type Data = Record<string, unknown>;

const validCardId = (value: string) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, "INVALID_CARD_ID", "Card id không hợp lệ.");
};

const card = async (ctx: ServiceContext, id: string, includeInactive = false) => {
  validCardId(id);
  const result = await CreditCardModel.findOne({ _id: id, workspaceId: ctx.workspaceId, ...(includeInactive ? {} : { active: { $ne: false } }) }).lean() as Data | null;
  if (!result) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
  return result;
};

const legacyData = (value: unknown): Data[] => Array.isArray(value) ? value.filter((item): item is Data => Boolean(item) && typeof item === "object") : [];

const mergeLegacyMonths = (target: unknown, source: unknown) => {
  const result = new Map<number, Data>();
  for (const item of [...legacyData(target), ...legacyData(source)]) {
    const month = Number(item.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const current = result.get(month) ?? { month, spend: 0, cashback: 0, fee: 0, otherInterest: 0 };
    for (const field of ["spend", "cashback", "fee", "otherInterest"]) current[field] = Number(current[field] ?? 0) + Number(item[field] ?? 0);
    result.set(month, current);
  }
  return [...result.values()].sort((a, b) => Number(a.month) - Number(b.month));
};

const dependentCounts = async (ctx: ServiceContext, cardId: string) => {
  const [accounts, statements, cashbacks, fees] = await Promise.all([
    AccountModel.countDocuments({ workspaceId: ctx.workspaceId, creditCardId: cardId }),
    CardStatementModel.countDocuments({ workspaceId: ctx.workspaceId, userCardId: cardId }),
    MonthlyCardCashbackModel.countDocuments({ workspaceId: ctx.workspaceId, userCardId: cardId }),
    CardFeePaymentModel.countDocuments({ workspaceId: ctx.workspaceId, userCardId: cardId }),
  ]);
  return { accounts, statements, cashbacks, fees };
};

export class CardLifecycleService {
  /** Financial history is retained; delete is a reversible retirement. */
  static async retire(ctx: ServiceContext, id: string) {
    await card(ctx, id, true);
    const result = await CreditCardModel.findOneAndUpdate(
      { _id: id, workspaceId: ctx.workspaceId, active: { $ne: false } },
      { $set: { active: false, retiredAt: new Date() } },
      { returnDocument: "after" },
    ).lean();
    return { retired: Boolean(result), id };
  }

  /**
   * Merge is intentionally restricted to duplicate cards without domain
   * references. Financial history must never be guessed or reassigned.
   * The source remains as a retired redirect record for recovery/audit.
   */
  static async merge(ctx: ServiceContext, sourceId: string, targetId: string): Promise<{ targetCard: CardDto; retiredSourceId: string }> {
    if (sourceId === targetId) throw new ApiError(400, "INVALID_MERGE_TARGET", "Không thể merge một thẻ vào chính nó.");
    const [source, target] = await Promise.all([card(ctx, sourceId), card(ctx, targetId)]);
    if (!duplicateFingerprint(source) || duplicateFingerprint(source) !== duplicateFingerprint(target)) {
      throw new ApiError(409, "DUPLICATE_MISMATCH", "Hai thẻ không phải duplicate exact-match.");
    }
    const counts = await dependentCounts(ctx, sourceId);
    if (Object.values(counts).some((value) => value > 0)) {
      throw new ApiError(409, "CARD_MERGE_HAS_HISTORY", "Không merge thẻ đã có account, sao kê, cashback hoặc phí; hãy giữ thẻ này ở trạng thái retired để bảo toàn lịch sử.", { counts: JSON.stringify(counts) });
    }
    let updated: Data | null = null;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        updated = await CreditCardModel.findOneAndUpdate(
          { _id: targetId, workspaceId: ctx.workspaceId, active: { $ne: false } },
          { $set: { monthlyData: mergeLegacyMonths(target.monthlyData, source.monthlyData) } },
          { returnDocument: "after", session },
        ).lean() as Data | null;
        if (!updated) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ đích.");
        await CreditCardModel.updateOne(
          { _id: sourceId, workspaceId: ctx.workspaceId, active: { $ne: false } },
          { $set: { active: false, retiredAt: new Date(), mergedIntoCardId: new mongoose.Types.ObjectId(targetId) } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    if (!updated) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ đích.");
    return { targetCard: cardDtoFromDocument(updated), retiredSourceId: sourceId };
  }
}
