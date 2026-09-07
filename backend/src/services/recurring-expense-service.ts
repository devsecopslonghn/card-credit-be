import mongoose from "mongoose";
import { RecurringExpenseModel } from "../models/recurring-expense.js";
import { AccountModel } from "../models/account.js";
import { ApiError } from "../errors.js";
import { idOf, plain, validDate } from "../statement-domain.js";
import type { ServiceContext } from "./types/service-context.js";
import { recurringExpenseInputSchema, recurringExpenseListSchema, recurringExpenseSchema } from "@card-credit/contracts";
const Recurring = RecurringExpenseModel as unknown as mongoose.Model<Record<string, unknown>>;

const MAX_RECURRING_LIMIT = 100;

const normalizeInput = (input: unknown) => {
  const parsed = recurringExpenseInputSchema.safeParse(input);
  if (!parsed.success || !validDate(parsed.data?.nextDueDate ?? "")) throw new ApiError(400, "INVALID_RECURRING_EXPENSE", "Khoản định kỳ không hợp lệ.");
  return parsed.data;
};

const toDto = (item: Record<string, unknown>) => recurringExpenseSchema.parse({
  id: idOf(item._id),
  name: item.name,
  categoryId: item.categoryId,
  accountId: idOf(item.accountId),
  expectedAmount: item.expectedAmount,
  frequency: item.frequency ?? "MONTHLY",
  nextDueDate: item.nextDueDate,
  active: item.active !== false,
});

export class RecurringExpenseService {
  static async list(ctx: ServiceContext, limit = MAX_RECURRING_LIMIT) {
    const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_RECURRING_LIMIT) : MAX_RECURRING_LIMIT;
    const items = await Recurring.find({ workspaceId: ctx.workspaceId, active: { $ne: false } }).sort({ nextDueDate: 1 }).limit(boundedLimit).lean();
    return recurringExpenseListSchema.parse(items.map((item) => toDto(item)));
  }

  static async create(ctx: ServiceContext, input: unknown) {
    const normalized = normalizeInput(input);
    if (!mongoose.isValidObjectId(normalized.accountId) || !await AccountModel.exists({ _id: normalized.accountId, workspaceId: ctx.workspaceId, active: { $ne: false } })) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản.");
    const item = await Recurring.create({ ...normalized, workspaceId: ctx.workspaceId, userId: ctx.userId, active: true });
    return toDto({ ...plain(item), _id: item._id });
  }

  static async update(ctx: ServiceContext, id: string, input: unknown) {
    const normalized = normalizeInput(input);
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, "RECURRING_EXPENSE_NOT_FOUND", "Không tìm thấy khoản định kỳ.");
    if (!mongoose.isValidObjectId(normalized.accountId) || !await AccountModel.exists({ _id: normalized.accountId, workspaceId: ctx.workspaceId, active: { $ne: false } })) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Không tìm thấy tài khoản.");
    const item = await Recurring.findOneAndUpdate({ _id: id, workspaceId: ctx.workspaceId, active: { $ne: false } }, { $set: normalized }, { new: true, returnDocument: "after", runValidators: true }).lean();
    if (!item) throw new ApiError(404, "RECURRING_EXPENSE_NOT_FOUND", "Không tìm thấy khoản định kỳ.");
    return toDto(item);
  }

  static async deactivate(ctx: ServiceContext, id: string) {
    if (!mongoose.isValidObjectId(id)) throw new ApiError(404, "RECURRING_EXPENSE_NOT_FOUND", "Không tìm thấy khoản định kỳ.");
    const item = await Recurring.findOneAndUpdate({ _id: id, workspaceId: ctx.workspaceId, active: { $ne: false } }, { $set: { active: false } }, { new: true, returnDocument: "after" }).lean();
    if (!item) throw new ApiError(404, "RECURRING_EXPENSE_NOT_FOUND", "Không tìm thấy khoản định kỳ.");
    return toDto(item);
  }
}
