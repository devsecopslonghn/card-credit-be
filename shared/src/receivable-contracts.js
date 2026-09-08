import { z } from "zod";

export const settleReceivableInputSchema = z.object({
  receivableId: z.string().trim().min(1).optional(),
  transactionId: z.string().trim().min(1).optional(),
  amount: z.number().int().positive().refine(Number.isSafeInteger),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().nonnegative().optional(),
}).superRefine((value, context) => {
  if (!value.receivableId && !value.transactionId) context.addIssue({ code: "custom", path: ["receivableId"], message: "Cần receivableId hoặc transactionId." });
  if (value.receivableId && value.transactionId && value.receivableId !== value.transactionId) context.addIssue({ code: "custom", path: ["transactionId"], message: "Chỉ được chỉ định một receivable reference." });
});
