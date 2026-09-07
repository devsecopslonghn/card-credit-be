import { z } from "zod";
import { isoDateSchema } from "./date-contracts.js";

const safePositiveInteger = z.number().int().refine(Number.isSafeInteger, "Must be a safe integer").positive();

export const recurringFrequencySchema = z.literal("MONTHLY");
export const recurringExpenseInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().trim().min(1).max(80),
  accountId: z.string().min(1),
  expectedAmount: safePositiveInteger,
  frequency: recurringFrequencySchema,
  nextDueDate: isoDateSchema,
});
export const recurringExpenseSchema = recurringExpenseInputSchema.extend({
  id: z.string().min(1),
  active: z.boolean(),
});
export const recurringExpenseListSchema = z.array(recurringExpenseSchema);
