import { FinanceBudgetModel } from "../models/finance-budget.js";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { ApiError } from "../errors.js";
import { idOf } from "../statement-domain.js";
import type { ServiceContext } from "./types/service-context.js";
import mongoose from "mongoose";
import { budgetStatusListSchema, budgetStatusSchemaDto } from "@card-credit/contracts";

const Budgets = FinanceBudgetModel as unknown as mongoose.Model<Record<string, unknown>>;

const monthRange = (month: string) => ({ from: `${month}-01`, to: `${month}-31` });

export const toBudgetStatusDto = (budget: Record<string, unknown> & { _id: unknown }, month: string, usedAmount: number) => {
  const limitAmount = Number(budget.limitAmount);
  const amount = Number(usedAmount);
  const usagePercent = limitAmount ? (amount / limitAmount) * 100 : 0;
  return budgetStatusSchemaDto.parse({
    id: idOf(budget._id),
    month,
    categoryId: String(budget.categoryId),
    limitAmount,
    usedAmount: amount,
    remainingAmount: Math.max(limitAmount - amount, 0),
    usagePercent,
    status: usagePercent >= 100 ? "EXCEEDED" : usagePercent >= Number(budget.warningPercent ?? 80) ? "WARNING" : "SAFE",
  });
};

export class FinanceBudgetService {
  static async upsert(ctx: ServiceContext, input: { month: string; categoryId: string; limitAmount: number; warningPercent?: number }) {
    if (!/^\d{4}-\d{2}$/.test(input.month) || !Number.isSafeInteger(input.limitAmount) || input.limitAmount <= 0) throw new ApiError(400, "INVALID_BUDGET", "Budget không hợp lệ.");
    const budget = await Budgets.findOneAndUpdate(
      { workspaceId: ctx.workspaceId, month: input.month, categoryId: input.categoryId },
      { $set: { limitAmount: input.limitAmount, warningPercent: input.warningPercent ?? 80, active: true } },
      { upsert: true, returnDocument: "after", runValidators: true },
    ).lean();
    return { id: idOf(budget?._id), month: budget?.month, categoryId: budget?.categoryId, limitAmount: budget?.limitAmount, warningPercent: budget?.warningPercent };
  }

  static async status(ctx: ServiceContext, month: string) {
    const budgets = await Budgets.find({ workspaceId: ctx.workspaceId, month, active: { $ne: false } }).lean();
    const range = monthRange(month);
    const totals = await FinancialTransactionModel.aggregate([
      { $match: { workspaceId: ctx.workspaceId, transactionDate: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$categoryId", amount: { $sum: "$personalSpending" } } },
    ]);
    const used = new Map(totals.map((item) => [String(item._id), Number(item.amount ?? 0)]));
    return budgetStatusListSchema.parse(budgets.map((budget) => toBudgetStatusDto(budget, month, used.get(String(budget.categoryId)) ?? 0)));
  }
}
