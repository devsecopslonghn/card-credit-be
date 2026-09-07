import { FinanceCategoryModel } from "../models/finance-category.js";
import { ApiError } from "../errors.js";
import { idOf, plain } from "../statement-domain.js";
import type { ServiceContext } from "./types/service-context.js";
import mongoose from "mongoose";
import { boundedReadLimit } from "../read-limits.js";
import { financeCategoryListSchema, financeCategorySchema } from "@card-credit/contracts";

const Categories = FinanceCategoryModel as unknown as mongoose.Model<Record<string, unknown>>;

export class FinanceCategoryService {
  static async list(ctx: ServiceContext, rawLimit?: unknown) {
    const existing = await Categories.find({ workspaceId: ctx.workspaceId, active: { $ne: false } }).sort({ name: 1 }).limit(boundedReadLimit(rawLimit)).lean();
    return financeCategoryListSchema.parse(existing.map((item) => ({ id: idOf(item._id), name: item.name, parentId: item.parentId ?? null, system: item.system === true })));
  }

  static async create(ctx: ServiceContext, input: { name: string; parentId?: string }) {
    const name = input.name.trim().toUpperCase();
    if (!name || name.length > 80) throw new ApiError(400, "INVALID_CATEGORY", "Tên category không hợp lệ.");
    try {
      return financeCategorySchema.parse(plain(await Categories.create({ workspaceId: ctx.workspaceId, name, parentId: input.parentId ?? null, system: false })));
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ApiError(409, "CATEGORY_EXISTS", "Category đã tồn tại.");
      throw error;
    }
  }
}
