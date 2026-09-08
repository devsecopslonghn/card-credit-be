/**
 * Creates the stable API error envelope shared by browser and server adapters.
 * This module is deliberately pure: it must never import environment, database,
 * framework, authentication, or logging code.
 */
export const createApiErrorBody = (code, message, fields) => ({
  error: {
    code,
    message,
    ...(fields ? { fields } : {}),
  },
});

export const isApiErrorBody = (value) => Boolean(
  value &&
  typeof value === "object" &&
  "error" in value &&
  value.error &&
  typeof value.error === "object" &&
  "code" in value.error &&
  typeof value.error.code === "string" &&
  "message" in value.error &&
  typeof value.error.message === "string",
);

export { isoDateSchema } from "./date-contracts.js";

export {
  accountTypeSchema,
  realMoneyAccountTypeSchema,
  accountGroupSchema,
  createAccountInputSchema,
  createRealMoneyAccountInputSchema,
  accountSchema,
  accountListSchema,
  mergeAccountsInputSchema,
  mergeAccountsPreviewSchema,
} from "./account-contracts.js";
export {
  catalogNetworkSchema,
  catalogThemeSchema,
  catalogProductSchema,
  catalogProviderSchema,
  catalogProductListSchema,
  catalogProviderListSchema,
} from "./catalog-contracts.js";
export {
  monthlyCardDataSchema,
  cardPortfolioCardSchema,
  cardPortfolioListSchema,
} from "./portfolio-contracts.js";
export {
  financialTransactionTypeSchema,
  ownershipSchema,
  FINANCIAL_TRANSACTION_DEFAULT_LIMIT,
  FINANCIAL_TRANSACTION_MAX_LIMIT,
  createFinancialTransactionInputSchema,
  updateFinancialTransactionInputSchema,
  createFinancialTransactionBatchInputSchema,
  financialTransactionListQuerySchema,
  financialImpactSchema,
  financialTransactionSchema,
  financialTransactionListSchema,
} from "./transaction-contracts.js";
export {
  budgetMonthSchema,
  budgetStatusSchema,
  budgetStatusSchemaDto,
  budgetStatusListSchema,
} from "./planning-contracts.js";
export {
  financeCategoryInputSchema,
  financeCategorySchema,
  financeCategoryListSchema,
} from "./finance-category-contracts.js";
export {
  recurringFrequencySchema,
  recurringExpenseInputSchema,
  recurringExpenseSchema,
  recurringExpenseListSchema,
} from "./recurring-expense-contracts.js";
export {
  statementPaymentStatusSchema,
  statementPaymentActionSchema,
  statementPaymentInputSchema,
  statementPaymentExecuteInputSchema,
  statementPaymentPreviewWarningSchema,
  statementPaymentPreviewDataSchema,
  statementPaymentPreviewSchema,
  statementSummarySchema,
  statementSchema,
  statementListSchema,
} from "./statement-contracts.js";
export {
  reportDateSchema,
  reportDateRangeSchema,
  reportQueryInputSchema,
  reportQuerySchema,
  resolveReportDateRange,
  financialReportMetricSchema,
  financialReportTotalsSchema,
  financialReportSchema,
  creditDebtLedgerItemSchema,
  creditDebtLedgerListSchema,
} from "./report-contracts.js";
export {
  feeCategorySchema,
  feePaymentSchema,
  feeCardSummarySchema,
  feeCenterRecordSchema,
  feePaymentListSchema,
  feeCenterRecordListSchema,
} from "./fee-contracts.js";
export {
  monthlyCashbackStatusSchema,
  monthlyCashbackSchema,
  monthlyCashbackListSchema,
} from "./monthly-cashback-contracts.js";
export {
  cardDuplicateGroupSchema,
  cardDuplicateGroupListSchema,
} from "./duplicate-contracts.js";
export {
  cashFlowCardSummarySchema,
  monthlyCashFlowRowSchema,
  monthlyCashFlowResponseSchema,
} from "./cash-flow-contracts.js";
export {
  calendarSubscriptionSchema,
  calendarSubscriptionListSchema,
  calendarSubscriptionCreateSchema,
} from "./calendar-subscription-contracts.js";
export {
  masterBankSchema,
  masterBankListSchema,
  masterCardTypeSchema,
  masterCardTypeListSchema,
} from "./masterdata-contracts.js";
export { userSchema, userListSchema } from "./user-contracts.js";
export { authSessionSchema, authSessionListSchema } from "./auth-contracts.js";
export { settleReceivableInputSchema } from "./receivable-contracts.js";
