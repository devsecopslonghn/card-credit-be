import type { z } from "zod";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

export declare const createApiErrorBody: (
  code: string,
  message: string,
  fields?: Record<string, string>,
) => ApiErrorBody;

export declare const isApiErrorBody: (value: unknown) => value is ApiErrorBody;
export declare const isoDateSchema: z.ZodString;

export declare const accountTypeSchema: z.ZodEnum<{
  DEBIT: "DEBIT";
  CASH: "CASH";
  E_WALLET: "E_WALLET";
  CREDIT: "CREDIT";
}>;
export declare const realMoneyAccountTypeSchema: z.ZodEnum<{
  DEBIT: "DEBIT";
  CASH: "CASH";
  E_WALLET: "E_WALLET";
}>;
export declare const accountGroupSchema: z.ZodEnum<{
  REAL_MONEY: "REAL_MONEY";
  DEBT: "DEBT";
}>;

export type AccountType = z.infer<typeof accountTypeSchema>;
export type AccountGroup = z.infer<typeof accountGroupSchema>;
export type CreateAccountInput = {
  name: string;
  type: AccountType;
  creditCardId?: string;
  openingBalance: number;
};
export type CreateRealMoneyAccountInput = {
  name: string;
  type: Exclude<AccountType, "CREDIT">;
  openingBalance: number;
};
export type AccountDto = {
  id: string;
  name: string;
  type: AccountType;
  group: AccountGroup;
  currency: "VND";
  active: boolean;
  creditCardId: string | null;
  openingBalance: number;
  currentBalance: number;
  currentDebt: number;
};

export declare const createAccountInputSchema: z.ZodObject<any>;
export declare const createRealMoneyAccountInputSchema: z.ZodObject<any>;
export declare const accountSchema: z.ZodObject<any>;
export declare const accountListSchema: z.ZodArray<typeof accountSchema>;
export declare const mergeAccountsInputSchema: z.ZodObject<any>;
export declare const mergeAccountsPreviewSchema: z.ZodObject<any>;
export type MergeAccountsInput = {
  sourceAccountIds: string[];
  targetAccountId?: string;
  targetName?: string;
  targetType?: Exclude<AccountType, "CREDIT">;
  keepTargetAsCash: boolean;
  expectedVersion?: number;
};

export declare const catalogNetworkSchema: z.ZodEnum<{
  Visa: "Visa";
  Mastercard: "Mastercard";
  JCB: "JCB";
  "American Express": "American Express";
  UnionPay: "UnionPay";
  Napas: "Napas";
}>;
export declare const catalogThemeSchema: z.ZodObject<any>;
export declare const catalogProductSchema: z.ZodObject<any>;
export declare const catalogProviderSchema: z.ZodObject<any>;
export declare const catalogProductListSchema: z.ZodArray<typeof catalogProductSchema>;
export declare const catalogProviderListSchema: z.ZodArray<typeof catalogProviderSchema>;
export type CatalogProductDto = {
  presetId: string;
  providerCode: string;
  providerName: string;
  displayName: string;
  network: "Visa" | "Mastercard" | "JCB" | "American Express" | "UnionPay" | "Napas";
  segment: string;
  annualFee: number | null;
  targetSpendForWaiver: number | null;
  imageUrl: string | null;
  benefits: string[];
  sourceUrl: string;
  sourceCheckedAt: string;
  active: boolean;
  sortOrder: number;
  theme: { background: string; accent: string };
};
export type CatalogProviderDto = {
  providerCode: string;
  providerName: string;
  products: CatalogProductDto[];
};
export declare const monthlyCardDataSchema: z.ZodObject<any>;
export declare const cardPortfolioCardSchema: z.ZodObject<any>;
export declare const cardPortfolioListSchema: z.ZodArray<typeof cardPortfolioCardSchema>;
export type MonthlyCardDataDto = {
  month: number;
  spend: number;
  cashback: number;
  fee: number;
  otherInterest: number;
};
export type CardDto = {
  id: string;
  presetId: string | null;
  providerCode: string | null;
  providerName: string | null;
  displayName: string | null;
  network: string | null;
  legacy: boolean;
  owner: string;
  imageUrl: string | null;
  annualFee: number | null;
  targetSpendForWaiver: number | null;
  annualFeeWaiverTarget: number | null;
  statementDay: number | null;
  paymentDueDays: number | null;
  cashbackCapAmount: number | null;
  cashbackCapPeriod: "STATEMENT" | "CALENDAR_MONTH" | null;
  active: boolean;
  reminderEnabled: boolean;
  reminderDaysBefore: number[];
  reminderTimezone: string | null;
  reminderTime: string | null;
  statementDate: string | null;
  paymentDueDate: string | null;
  amountDueThisMonth: number | null;
  isPaidThisMonth: boolean | null;
  monthlyData: MonthlyCardDataDto[];
};
export type CardList = CardDto[];
export declare const monthlyCashbackStatusSchema: z.ZodEnum<{
  PENDING: "PENDING";
  RECEIVED: "RECEIVED";
  REJECTED: "REJECTED";
}>;
export declare const monthlyCashbackSchema: z.ZodObject<any>;
export declare const monthlyCashbackListSchema: z.ZodArray<typeof monthlyCashbackSchema>;
export type MonthlyCashbackStatus = "PENDING" | "RECEIVED" | "REJECTED";
export type MonthlyCashbackDto = {
  id: string;
  cardId: string;
  period: string;
  expectedAmount: number;
  actualAmount: number | null;
  status: MonthlyCashbackStatus;
  receivedAt: string | null;
  note: string;
};
export declare const cardDuplicateGroupSchema: z.ZodObject<any>;
export declare const cardDuplicateGroupListSchema: z.ZodArray<typeof cardDuplicateGroupSchema>;
export type CardDuplicateGroupDto = {
  fingerprint: string;
  presetId: string;
  normalizedOwner: string;
  reason: string;
  cards: CardDto[];
};
export declare const cashFlowCardSummarySchema: z.ZodObject<any>;
export declare const monthlyCashFlowRowSchema: z.ZodObject<any>;
export declare const monthlyCashFlowResponseSchema: z.ZodObject<any>;
export type CashFlowCardSummaryDto = {
  id: string;
  providerName: string | null;
  displayName: string | null;
  owner: string | null;
};
export type MonthlyCashFlowRowDto = {
  cardId: string;
  period: string;
  totalOut: number;
  totalIn: number;
  statementPayments: number;
  actualFees: number;
  partnerReturns: number;
  bankCashbackActual: number;
  netResult: number;
  card: CashFlowCardSummaryDto | null;
};
export type MonthlyCashFlowResponseDto = {
  data: MonthlyCashFlowRowDto[];
  period: string;
};
export declare const financialTransactionTypeSchema: z.ZodEnum<any>;
export declare const ownershipSchema: z.ZodEnum<any>;
export declare const FINANCIAL_TRANSACTION_DEFAULT_LIMIT: 100;
export declare const FINANCIAL_TRANSACTION_MAX_LIMIT: 100;
export declare const createFinancialTransactionInputSchema: z.ZodObject<any>;
export declare const updateFinancialTransactionInputSchema: z.ZodObject<any>;
export declare const createFinancialTransactionBatchInputSchema: z.ZodObject<any>;
export declare const financialTransactionListQuerySchema: z.ZodObject<any>;
export declare const financialImpactSchema: z.ZodObject<any>;
export declare const financialTransactionSchema: z.ZodObject<any>;
export declare const financialTransactionListSchema: z.ZodArray<typeof financialTransactionSchema>;
export type FinancialTransactionType = "EXPENSE" | "TRANSFER" | "REIMBURSEMENT" | "REFUND" | "CASHBACK" | "INCOME" | "STATEMENT_PAYMENT" | "BALANCE_ADJUSTMENT" | "OPENING_BALANCE_ADJUSTMENT";
export type Ownership = "PERSONAL" | "PAID_FOR_OTHER";
export type BalanceAdjustmentDirection = "INCREASE" | "DECREASE";
export type CreateFinancialTransactionInput = {
  accountId: string;
  transactionDate: string;
  amount: number;
  categoryId?: string;
  transactionType?: FinancialTransactionType;
  direction?: BalanceAdjustmentDirection;
  ownership?: Ownership;
  reimbursementExpected?: number;
  serviceFeeRate?: number;
  refundReceived?: number;
  cashbackReceived?: number;
  note?: string;
  statementId?: string;
  reimbursementForTransactionId?: string;
};
  export type UpdateFinancialTransactionInput = Partial<Omit<CreateFinancialTransactionInput, "statementId" | "reimbursementForTransactionId">>;
export type CreateFinancialTransactionBatchInput = { items: CreateFinancialTransactionInput[] };
export type FinancialTransactionListQuery = {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  limit?: number;
};
export type FinancialImpactDto = {
  personalSpending: number;
  debitCashflow: number;
  creditDebt: number;
  outstandingReceivable: number;
  reimbursementReceived: number;
};
export type FinancialTransactionDto = {
  id: string;
  accountId: string;
  statementId: string | null;
  reimbursementForTransactionId: string | null;
  accountType: "DEBIT" | "CASH" | "E_WALLET" | "CREDIT";
  transactionType: FinancialTransactionType;
  direction?: BalanceAdjustmentDirection;
  ownership: Ownership;
  amount: number;
  serviceFeeRate: number | null;
  categoryId: string;
  transactionDate: string;
  note: string;
  impact: FinancialImpactDto;
};
export declare const budgetMonthSchema: z.ZodString;
export declare const budgetStatusSchema: z.ZodEnum<any>;
export declare const budgetStatusSchemaDto: z.ZodObject<any>;
export declare const budgetStatusListSchema: z.ZodArray<typeof budgetStatusSchemaDto>;
export type BudgetStatus = "SAFE" | "WARNING" | "EXCEEDED";
export type BudgetStatusDto = {
  id: string;
  month: string;
  categoryId: string;
  limitAmount: number;
  usedAmount: number;
  remainingAmount: number;
  usagePercent: number;
  status: BudgetStatus;
};

export declare const financeCategoryInputSchema: z.ZodObject<any>;
export declare const financeCategorySchema: z.ZodObject<any>;
export declare const financeCategoryListSchema: z.ZodArray<typeof financeCategorySchema>;
export type FinanceCategoryDto = {
  id: string;
  name: string;
  parentId: string | null;
  system: boolean;
};

export declare const recurringFrequencySchema: z.ZodLiteral<"MONTHLY">;
export declare const recurringExpenseInputSchema: z.ZodObject<any>;
export declare const recurringExpenseSchema: z.ZodObject<any>;
export declare const recurringExpenseListSchema: z.ZodArray<typeof recurringExpenseSchema>;
export type RecurringExpenseDto = {
  id: string;
  name: string;
  categoryId: string;
  accountId: string;
  expectedAmount: number;
  frequency: "MONTHLY";
  nextDueDate: string;
  active: boolean;
};
export type RecurringExpenseInput = Omit<RecurringExpenseDto, "id" | "active">;
export declare const statementSummarySchema: z.ZodObject<any>;
export declare const statementSchema: z.ZodObject<any>;
export declare const statementListSchema: z.ZodArray<typeof statementSchema>;
export declare const statementPaymentStatusSchema: z.ZodEnum<any>;
export declare const statementPaymentActionSchema: z.ZodEnum<any>;
export declare const statementPaymentInputSchema: z.ZodObject<any>;
export declare const statementPaymentExecuteInputSchema: z.ZodObject<any>;
export declare const statementPaymentPreviewWarningSchema: z.ZodEnum<any>;
export declare const statementPaymentPreviewDataSchema: z.ZodObject<any>;
export declare const statementPaymentPreviewSchema: z.ZodObject<any>;
export type StatementSummaryDto = {
  statementAmount: number;
  paymentAmount: number;
  outstandingAmount: number;
  personalSpending: number;
  outstandingReceivable: number;
  reimbursementReceived: number;
  transactionCount: number;
};
export type StatementDto = {
  id: string;
  cardId: string;
  periodStartDate: string;
  periodEndDate: string;
  statementDate: string;
  paymentDueDate: string;
  statementDaySnapshot: number;
  paymentDueDaysSnapshot: number;
  paymentStatus: "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE";
  effectivePaymentStatus: "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE";
  paidAt: string | null;
  paidAmount: number | null;
  summary: StatementSummaryDto;
  transactions?: FinancialTransactionDto[];
};
export type StatementPaymentAction = "CLOSED" | "PAID" | "REOPEN";
export type StatementPaymentInput = { action: StatementPaymentAction; repaymentAccountId?: string; reason?: string; reverseErroneousPayment?: boolean; expectedVersion?: string };
export type StatementPaymentPreviewWarning = "ALREADY_SETTLED" | "NO_OUTSTANDING_BALANCE" | "REPAYMENT_ACCOUNT_REQUIRED";
export type StatementPaymentPreviewDto = {
  operation: "pay_statement";
  cardId: string;
  statementId: string;
  action: StatementPaymentAction;
  paymentStatus: "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE";
  nextPaymentStatus: "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE";
  statementAmount: number;
  paymentAmount: number;
  outstandingAmount: number;
  amountToPay: number;
  repaymentAccountId: string | null;
  version: string | null;
  requiresRepaymentAccount: boolean;
  warnings: StatementPaymentPreviewWarning[];
  previewId: string;
  confirmationToken: string;
  expiresAt: string;
};
export type StatementPaymentPreviewDataDto = Omit<StatementPaymentPreviewDto, "previewId" | "confirmationToken" | "expiresAt">;

export declare const financialReportMetricSchema: z.ZodObject<any>;
export declare const financialReportTotalsSchema: z.ZodObject<any>;
export declare const financialReportSchema: z.ZodObject<any>;
export declare const creditDebtLedgerItemSchema: z.ZodObject<any>;
export declare const creditDebtLedgerListSchema: z.ZodArray<typeof creditDebtLedgerItemSchema>;
export declare const reportDateSchema: z.ZodString;
export declare const reportDateRangeSchema: z.ZodObject<any>;
export declare const reportQueryInputSchema: z.ZodObject<any>;
export declare const reportQuerySchema: z.ZodObject<any>;
export declare const resolveReportDateRange: (
  input?: { from?: string; to?: string; year?: string; month?: string },
  today?: Date,
) => { from: string; to: string };
export type FinancialReportMetricDto = {
  personalSpending: number;
  debitCashflow: number;
  creditDebt: number;
  outstandingReceivable: number;
  reimbursementReceived: number;
  transactionCount: number;
};
export type FinancialReportTotalsDto = FinancialReportMetricDto & {
  totalServiceFee: number;
  transactionCashbackActual: number;
  monthlyBankCashbackExpected: number;
  monthlyBankCashbackActual: number;
  monthlyBankCashbackRejected: number;
  totalPaidCardFees: number;
  actualNetBenefit: number;
  activeCashBalance: number;
  activeBankBalance: number;
  currentCardDebt: number;
  paidStatementDebt: number;
  realIncome: number;
  technicalAdjustments: number;
  operatingCashflow: number;
};
export type FinancialReportDto = {
  range: { from: string; to: string };
  totals: FinancialReportTotalsDto;
  netAssets: number;
  creditDebtBalance: number;
  debit: FinancialReportMetricDto;
  cash: FinancialReportMetricDto;
  eWallet: FinancialReportMetricDto;
  realMoney: FinancialReportMetricDto;
  credit: FinancialReportMetricDto;
  creditDebtLedger: CreditDebtLedgerItemDto[];
  byCategory: Record<string, FinancialReportMetricDto>;
  byAccount: Record<string, FinancialReportMetricDto & { name: string }>;
};
export type CreditDebtLedgerItemDto = {
  cardId: string;
  statementId: string;
  providerName: string;
  displayName: string;
  owner: string;
  statementDate: string;
  paymentDueDate: string;
  paymentStatus: "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE";
  grossDebt: number;
  paidDebt: number;
  outstandingDebt: number;
  transactionCount: number;
};
export declare const feeCategorySchema: z.ZodEnum<any>;
export declare const feePaymentSchema: z.ZodObject<any>;
export declare const feeCardSummarySchema: z.ZodObject<any>;
export declare const feeCenterRecordSchema: z.ZodObject<any>;
export declare const feePaymentListSchema: z.ZodArray<typeof feePaymentSchema>;
export declare const feeCenterRecordListSchema: z.ZodArray<typeof feeCenterRecordSchema>;
export type FeeCategory = "ANNUAL_CARD_FEE" | "MANAGEMENT_FEE" | "OTHER_FEE" | "BANK_CASHBACK" | "PARTNER_REFUND";
export type FeePaymentDto = {
  id: string;
  cardId: string;
  category: FeeCategory;
  paymentDate: string;
  amount: number;
  note: string;
};
export type FeeCardSummaryDto = {
  id: string;
  providerName: string | null;
  displayName: string | null;
  owner: string;
};
export type FeeCenterRecordDto = FeePaymentDto & { card: FeeCardSummaryDto | null };

export declare const calendarSubscriptionSchema: z.ZodObject<any>;
export declare const calendarSubscriptionListSchema: z.ZodArray<typeof calendarSubscriptionSchema>;
export declare const calendarSubscriptionCreateSchema: z.ZodObject<any>;
export type CalendarSubscriptionDto = {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastAccessedAt: string | null;
  revokedAt: string | null;
};
export type CalendarSubscriptionCreateDto = CalendarSubscriptionDto & { subscriptionPath: string };

export declare const masterBankSchema: z.ZodObject<any>;
export declare const masterBankListSchema: z.ZodArray<typeof masterBankSchema>;
export declare const masterCardTypeSchema: z.ZodObject<any>;
export declare const masterCardTypeListSchema: z.ZodArray<typeof masterCardTypeSchema>;
export type MasterBankDto = {
  _id: string;
  shortname: string;
  name: string;
  fullname: string;
  logo: string;
};
export type MasterCardTypeDto = {
  _id: string;
  name: string;
  logo: string;
};
export declare const userSchema: z.ZodObject<any>;
export declare const userListSchema: z.ZodArray<typeof userSchema>;
export type UserDto = {
  id: string;
  email: string;
  role: "admin" | "user";
  workspaceId: string;
  displayName: string;
  active: boolean;
  lockedAt: string | null;
};
export declare const authSessionSchema: z.ZodObject<any>;
export declare const authSessionListSchema: z.ZodArray<typeof authSessionSchema>;
export declare const settleReceivableInputSchema: z.ZodObject<any>;
export type AuthSessionDto = {
  email: string;
  role: "admin" | "user";
  workspaceId: string;
};
