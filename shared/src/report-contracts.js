import { z } from "zod";
import { statementPaymentStatusSchema } from "./statement-contracts.js";
import { isoDateSchema } from "./date-contracts.js";

const safeInteger = z.number().int().refine(Number.isSafeInteger, "Must be a safe integer");
const safeNonNegativeInteger = safeInteger.nonnegative();
const safePositiveInteger = safeInteger.positive();
export const reportDateSchema = isoDateSchema;

export const reportDateRangeSchema = z.strictObject({
  from: reportDateSchema,
  to: reportDateSchema,
}).superRefine((range, context) => {
  if (range.from > range.to) context.addIssue({ code: "custom", path: ["to"], message: "The report range must be ordered from earliest to latest date" });
});

export const reportQueryInputSchema = z.strictObject({
  from: reportDateSchema.optional(),
  to: reportDateSchema.optional(),
  cardId: z.string().min(1).optional(),
  owner: z.string().trim().min(1).max(120).optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  month: z.string().regex(/^(?:0?[1-9]|1[0-2])$/).optional(),
});

export const reportQuerySchema = reportQueryInputSchema.superRefine((query, context) => {
  if (query.month && !query.year) context.addIssue({ code: "custom", path: ["year"], message: "A report month requires a report year" });
  if ((query.year || query.month) && (query.from || query.to)) context.addIssue({ code: "custom", path: ["from"], message: "Use either calendar year/month or an explicit date range" });
});

/** Resolve the REST-compatible current-month-to-today default without transport concerns. */
export const resolveReportDateRange = (input = {}, today = new Date()) => {
  if (input.year) {
    const year = input.year;
    const month = input.month ? String(input.month).padStart(2, "0") : null;
    const from = `${year}-${month ?? "01"}-01`;
    const to = month
      ? `${year}-${month}-${String(new Date(Number(year), Number(month), 0).getDate()).padStart(2, "0")}`
      : `${year}-12-31`;
    return reportDateRangeSchema.parse({ from, to });
  }
  const todayValue = today instanceof Date && !Number.isNaN(today.valueOf())
    ? today.toISOString().slice(0, 10)
    : reportDateSchema.parse(today);
  return reportDateRangeSchema.parse({
    from: input.from ?? `${todayValue.slice(0, 7)}-01`,
    to: input.to ?? todayValue,
  });
};

/** Ledger metrics are intentionally shared by totals and each grouping. */
export const financialReportMetricSchema = z.object({
  personalSpending: safeInteger,
  debitCashflow: safeInteger,
  creditDebt: safeInteger,
  outstandingReceivable: safeNonNegativeInteger,
  reimbursementReceived: safeNonNegativeInteger,
  transactionCount: safeNonNegativeInteger,
});

/**
 * Benefit KPIs are kept on totals only. Grouped ledger metrics must not gain
 * fee/cashback semantics that they cannot prove from their source collection.
 */
export const financialReportTotalsSchema = financialReportMetricSchema.extend({
  totalServiceFee: safeNonNegativeInteger,
  transactionCashbackActual: safeNonNegativeInteger,
  monthlyBankCashbackExpected: safeNonNegativeInteger,
  monthlyBankCashbackActual: safeNonNegativeInteger,
  monthlyBankCashbackRejected: safeNonNegativeInteger,
  totalPaidCardFees: safeNonNegativeInteger,
  actualNetBenefit: safeInteger,
  activeCashBalance: safeInteger,
  activeBankBalance: safeInteger,
  currentCardDebt: safeNonNegativeInteger,
  paidStatementDebt: safeNonNegativeInteger,
  grossReceivable: safeNonNegativeInteger,
  collectedReceivable: safeNonNegativeInteger,
  paidStatementReceivable: safeNonNegativeInteger,
  realIncome: safeNonNegativeInteger,
  technicalAdjustments: safeInteger,
  operatingCashflow: safeInteger,
});

const accountMetricSchema = financialReportMetricSchema.extend({ name: z.string() });

export const creditDebtLedgerItemSchema = z.strictObject({
  cardId: z.string().min(1),
  statementId: z.string().min(1),
  providerName: z.string(),
  displayName: z.string(),
  owner: z.string(),
  statementDate: reportDateSchema,
  paymentDueDate: reportDateSchema,
  paymentStatus: statementPaymentStatusSchema,
  grossDebt: safeNonNegativeInteger,
  paidDebt: safeNonNegativeInteger,
  outstandingDebt: safeNonNegativeInteger,
  transactionCount: safeNonNegativeInteger,
});

export const creditDebtLedgerListSchema = z.array(creditDebtLedgerItemSchema);

export const financialReportSchema = z.object({
  range: reportDateRangeSchema,
  totals: financialReportTotalsSchema,
  netAssets: safeInteger,
  creditDebtBalance: safeInteger,
  debit: financialReportMetricSchema,
  cash: financialReportMetricSchema,
  eWallet: financialReportMetricSchema,
  realMoney: financialReportMetricSchema,
  credit: financialReportMetricSchema,
  creditDebtLedger: creditDebtLedgerListSchema.default([]),
  byCategory: z.record(z.string(), financialReportMetricSchema),
  byAccount: z.record(z.string(), accountMetricSchema),
});
