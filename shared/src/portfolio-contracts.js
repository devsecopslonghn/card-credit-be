import { z } from "zod";

export const cardPortfolioCardSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
  providerCode: z.string().min(1),
  providerName: z.string().min(1),
  displayName: z.string().min(1),
  network: z.string().min(1),
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
});

export const cardPortfolioListSchema = z.array(cardPortfolioCardSchema);
