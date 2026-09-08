import { z } from "zod";

const amount = z.number().int().nonnegative();

export const cashFlowCardSummarySchema = z.object({
  id: z.string().min(1),
  providerName: z.string().nullable(),
  displayName: z.string().nullable(),
  owner: z.string().nullable(),
});

export const monthlyCashFlowRowSchema = z.object({
  cardId: z.string().min(1),
  period: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/),
  totalOut: amount,
  totalIn: amount,
  statementPayments: amount,
  actualFees: amount,
  partnerReturns: amount,
  bankCashbackActual: amount,
  netResult: z.number().int(),
  card: cashFlowCardSummarySchema.nullable(),
});

export const monthlyCashFlowResponseSchema = z.object({
  data: z.array(monthlyCashFlowRowSchema),
  period: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/),
});
