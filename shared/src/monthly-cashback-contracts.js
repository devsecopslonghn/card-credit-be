import { z } from "zod";

const safeNonNegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger, "Must be a safe integer");
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((value) => {
  const [year, month] = value.split("-").map(Number);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 && month >= 1 && month <= 12;
}, "Must be a valid calendar month");

export const monthlyCashbackStatusSchema = z.enum(["PENDING", "RECEIVED", "REJECTED"]);

export const monthlyCashbackSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  period: periodSchema,
  expectedAmount: safeNonNegativeInteger,
  actualAmount: safeNonNegativeInteger.nullable(),
  status: monthlyCashbackStatusSchema,
  receivedAt: z.string().nullable(),
  note: z.string(),
});

export const monthlyCashbackListSchema = z.array(monthlyCashbackSchema);
