import { MonthlyCardCashbackModel } from "../models/monthly-card-cashback.js";
import { ApiError } from "../errors.js";
import { CardQueryService } from "./card-query-service.js";
import type { ServiceContext } from "./types/service-context.js";

type Data = Record<string, unknown>;
type Status = "PENDING" | "RECEIVED" | "REJECTED";

const validPeriod = (value: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new ApiError(400, "INVALID_PERIOD", "Kỳ cashback không hợp lệ.", { period: "Kỳ cashback phải có dạng YYYY-MM." });
  return value;
};
const amount = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ApiError(400, "INVALID_CASHBACK", "Số tiền cashback không hợp lệ.", { [field]: "Số tiền phải là số nguyên VND không âm." });
  return value;
};
const status = (value: unknown): Status => {
  if (value !== "PENDING" && value !== "RECEIVED" && value !== "REJECTED") throw new ApiError(400, "INVALID_CASHBACK_STATUS", "Trạng thái cashback không hợp lệ.");
  return value;
};
const note = (value: unknown) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 1000) throw new ApiError(400, "INVALID_CASHBACK", "Ghi chú cashback không hợp lệ.", { note: "Ghi chú tối đa 1000 ký tự." });
  return value.trim();
};

export class MonthlyCashbackCommandService {
  static async upsert(ctx: ServiceContext, cardId: string, periodValue: string, body: Data) {
    await CardQueryService.get(ctx, cardId);
    const period = validPeriod(periodValue);
    const nextStatus = status(body.status);
    const expectedAmount = amount(body.expectedAmount, "expectedAmount");
    const actualAmount = nextStatus === "RECEIVED" ? amount(body.actualAmount, "actualAmount") : null;
    const filter = { workspaceId: ctx.workspaceId, userCardId: cardId, period };
    const existing = await MonthlyCardCashbackModel.findOne(filter);
    const existingData = existing ? JSON.parse(JSON.stringify(existing)) as Data : null;
    const receivedAt = nextStatus === "RECEIVED"
      ? existingData?.status === "RECEIVED" && existingData.receivedAt ? new Date(String(existingData.receivedAt)) : new Date()
      : null;
    return MonthlyCardCashbackModel.findOneAndUpdate(filter, { $set: { expectedAmount, actualAmount, status: nextStatus, receivedAt, note: note(body.note) }, $setOnInsert: { workspaceId: ctx.workspaceId, userId: ctx.userId, userCardId: cardId, period } }, { upsert: true, returnDocument: "after", runValidators: true });
  }

  static async delete(ctx: ServiceContext, cardId: string, periodValue: string) {
    await CardQueryService.get(ctx, cardId);
    const period = validPeriod(periodValue);
    await MonthlyCardCashbackModel.deleteOne({ workspaceId: ctx.workspaceId, userCardId: cardId, period });
  }
}
