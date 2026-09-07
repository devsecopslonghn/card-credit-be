import { z } from "zod";
import { isoDateSchema } from "./date-contracts.js";

export const monthlyCardDataSchema = z.object({
  month: z.number().int().min(1).max(12),
  spend: z.number(),
  cashback: z.number(),
  fee: z.number(),
  otherInterest: z.number(),
});

export const cardPortfolioCardSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().nullable(),
  providerCode: z.string().nullable(),
  providerName: z.string().nullable(),
  displayName: z.string().nullable(),
  network: z.string().nullable(),
  legacy: z.boolean(),
  owner: z.string(),
  imageUrl: z.string().nullable(),
  annualFee: z.number().nullable(),
  targetSpendForWaiver: z.number().nullable(),
  annualFeeWaiverTarget: z.number().nullable(),
  statementDay: z.number().nullable(),
  paymentDueDays: z.number().nullable(),
  cashbackCapAmount: z.number().nullable(),
  cashbackCapPeriod: z.enum(["STATEMENT", "CALENDAR_MONTH"]).nullable(),
  active: z.boolean(),
  reminderEnabled: z.boolean(),
  reminderDaysBefore: z.array(z.number().int()),
  reminderTimezone: z.string().nullable(),
  reminderTime: z.string().nullable(),
  statementDate: isoDateSchema.nullable(),
  paymentDueDate: isoDateSchema.nullable(),
  amountDueThisMonth: z.number().nullable(),
  isPaidThisMonth: z.boolean().nullable(),
  monthlyData: z.array(monthlyCardDataSchema),
});

export const cardPortfolioListSchema = z.array(cardPortfolioCardSchema);
