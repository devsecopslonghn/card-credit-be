import { z } from "zod";
import { isoDateSchema } from "./date-contracts.js";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "Must be a safe integer");
const safePositiveInteger = safeInteger.positive();

export const feeCategorySchema = z.enum([
  "ANNUAL_CARD_FEE",
  "MANAGEMENT_FEE",
  "OTHER_FEE",
  "BANK_CASHBACK",
  "PARTNER_REFUND",
]);

export const feePaymentSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  category: feeCategorySchema,
  paymentDate: isoDateSchema,
  amount: safePositiveInteger,
  note: z.string(),
});

export const feeCardSummarySchema = z.object({
  id: z.string().min(1),
  providerName: z.string().nullable(),
  displayName: z.string().nullable(),
  owner: z.string(),
});

export const feeCenterRecordSchema = feePaymentSchema.extend({
  card: feeCardSummarySchema.nullable(),
});

export const feePaymentListSchema = z.array(feePaymentSchema);
export const feeCenterRecordListSchema = z.array(feeCenterRecordSchema);
