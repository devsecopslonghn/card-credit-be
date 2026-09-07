import type { StatementPaymentInput } from "@card-credit/contracts";

export const PAYMENT_OPERATION = "pay_statement" as const;

/** Canonical payload bound by both browser and MCP preview confirmations. */
export const paymentPreviewPayload = (cardId: string, statementId: string, input: StatementPaymentInput) => ({
  cardId,
  statementId,
  input: {
    action: input.action,
    ...(input.repaymentAccountId ? { repaymentAccountId: input.repaymentAccountId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.reverseErroneousPayment ? { reverseErroneousPayment: true } : {}),
    ...(input.expectedVersion ? { expectedVersion: input.expectedVersion } : {}),
  },
});
