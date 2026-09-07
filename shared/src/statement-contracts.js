import { z } from "zod";
import { financialTransactionSchema } from "./transaction-contracts.js";
import { isoDateSchema } from "./date-contracts.js";

const safeNonNegativeInteger = z.number().int().nonnegative().refine(Number.isSafeInteger, "Must be a safe integer");
const safePositiveInteger = z.number().int().positive().refine(Number.isSafeInteger, "Must be a safe integer");
export const statementPaymentStatusSchema = z.enum(["OPEN", "STATEMENT_CLOSED", "PAID", "OVERDUE"]);
export const statementPaymentActionSchema = z.enum(["CLOSED", "PAID", "REOPEN"]);
export const statementPaymentInputSchema = z.object({
  action: statementPaymentActionSchema,
  repaymentAccountId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(10).max(500).optional(),
  reverseErroneousPayment: z.boolean().optional(),
  expectedVersion: z.iso.datetime().optional(),
}).strict().superRefine((input, context) => {
  if (input.action === "REOPEN" && !input.reason) context.addIssue({ code: "custom", path: ["reason"], message: "REOPEN cần reason để audit correction." });
  if (input.reverseErroneousPayment && input.action !== "REOPEN") context.addIssue({ code: "custom", path: ["reverseErroneousPayment"], message: "Chỉ được reverse payment khi REOPEN correction." });
});
export const statementPaymentPreviewWarningSchema = z.enum(["ALREADY_SETTLED", "NO_OUTSTANDING_BALANCE", "REPAYMENT_ACCOUNT_REQUIRED"]);
const statementPaymentPreviewDataFields = {
  operation: z.literal("pay_statement"),
  cardId: z.string().min(1),
  statementId: z.string().min(1),
  action: statementPaymentActionSchema,
  paymentStatus: statementPaymentStatusSchema,
  nextPaymentStatus: statementPaymentStatusSchema,
  statementAmount: safeNonNegativeInteger,
  paymentAmount: safeNonNegativeInteger,
  outstandingAmount: safeNonNegativeInteger,
  amountToPay: safeNonNegativeInteger,
  repaymentAccountId: z.string().nullable(),
  version: z.iso.datetime().nullable(),
  requiresRepaymentAccount: z.boolean(),
  warnings: z.array(statementPaymentPreviewWarningSchema).max(8),
};
export const statementPaymentPreviewDataSchema = z.object(statementPaymentPreviewDataFields).strict();
export const statementPaymentPreviewSchema = statementPaymentPreviewDataSchema.extend({
  previewId: z.string().min(1),
  confirmationToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
}).strict();
export const statementPaymentExecuteInputSchema = statementPaymentInputSchema.extend({
  previewId: z.string().min(1),
  confirmationToken: z.string().min(1),
}).strict();

export const statementSummarySchema = z.object({
  statementAmount: safeNonNegativeInteger,
  paymentAmount: safeNonNegativeInteger,
  outstandingAmount: safeNonNegativeInteger,
  personalSpending: safeNonNegativeInteger,
  outstandingReceivable: safeNonNegativeInteger,
  reimbursementReceived: safeNonNegativeInteger,
  transactionCount: safeNonNegativeInteger,
});

export const statementSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  periodStartDate: isoDateSchema,
  periodEndDate: isoDateSchema,
  statementDate: isoDateSchema,
  paymentDueDate: isoDateSchema,
  statementDaySnapshot: z.number().int().min(1).max(31).refine(Number.isSafeInteger, "Must be a safe integer"),
  paymentDueDaysSnapshot: safePositiveInteger,
  paymentStatus: statementPaymentStatusSchema,
  effectivePaymentStatus: statementPaymentStatusSchema,
  paidAt: z.string().nullable(),
  paidAmount: safeNonNegativeInteger.nullable(),
  summary: statementSummarySchema,
  transactions: z.array(financialTransactionSchema).optional(),
});

export const statementListSchema = z.array(statementSchema);
