import { z } from "zod";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "Must be a safe integer");
const safePositiveInteger = safeInteger.positive();

export const budgetMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const budgetStatusSchema = z.enum(["SAFE", "WARNING", "EXCEEDED"]);
export const budgetStatusSchemaDto = z.object({
  id: z.string().min(1),
  month: budgetMonthSchema,
  categoryId: z.string().min(1),
  limitAmount: safePositiveInteger,
  usedAmount: safeInteger.nonnegative(),
  remainingAmount: safeInteger.nonnegative(),
  usagePercent: z.number().finite().nonnegative(),
  status: budgetStatusSchema,
});
export const budgetStatusListSchema = z.array(budgetStatusSchemaDto);
