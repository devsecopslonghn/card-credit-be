import { ApiError } from "./errors.js";

export type Data = Record<string, unknown>;
export const idOf = (value: unknown) =>
  value && typeof value === "object" && "toString" in value
    ? String(value)
    : String(value ?? "");
export const plain = (value: unknown): Data =>
  JSON.parse(JSON.stringify(value)) as Data;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const parse = (value: string) => {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return { year, month, day };
};
const format = (value: { year: number; month: number; day: number }) =>
  `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
const utc = (value: string) => {
  const { year, month, day } = parse(value);
  return Date.UTC(year, month - 1, day);
};
export const validDate = (value: unknown): value is string =>
  typeof value === "string" &&
  datePattern.test(value) &&
  format({
    year: new Date(utc(value)).getUTCFullYear(),
    month: new Date(utc(value)).getUTCMonth() + 1,
    day: new Date(utc(value)).getUTCDate(),
  }) === value;
const addDays = (value: string, days: number) => {
  const date = new Date(utc(value) + days * 86400000);
  return format({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
};
const statementForMonth = (year: number, month: number, day: number) =>
  format({
    year,
    month,
    day: Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate()),
  });
export const statementPeriod = (
  transactionDate: string,
  statementDay: number,
  paymentDueDays: number,
) => {
  const tx = parse(transactionDate);
  let statementDate = statementForMonth(tx.year, tx.month, statementDay);
  if (utc(transactionDate) > utc(statementDate)) {
    const next = new Date(Date.UTC(tx.year, tx.month, 1));
    statementDate = statementForMonth(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      statementDay,
    );
  }
  const current = parse(statementDate);
  const previousMonth = new Date(Date.UTC(current.year, current.month - 2, 1));
  const previous = statementForMonth(
    previousMonth.getUTCFullYear(),
    previousMonth.getUTCMonth() + 1,
    statementDay,
  );
  return {
    periodStartDate: addDays(previous, 1),
    periodEndDate: statementDate,
    statementDate,
    paymentDueDate: addDays(statementDate, paymentDueDays),
    statementDaySnapshot: statementDay,
    paymentDueDaysSnapshot: paymentDueDays,
  };
};
export const integer = (
  value: unknown,
  field: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ.", {
      [field]: `${field} phải là số nguyên từ ${min} đến ${max}.`,
    });
  return result;
};
export const transactionInput = (body: Data, current: Data = {}) => {
  const transactionDate = body.transactionDate ?? current.transactionDate;
  if (!validDate(transactionDate))
    throw new ApiError(400, "INVALID_DATE", "Ngày không hợp lệ.", {
      transactionDate: "Ngày phải theo định dạng YYYY-MM-DD.",
    });
  const outcomeAmount = integer(
    body.outcomeAmount ?? current.outcomeAmount,
    "outcomeAmount",
    1,
  );
  const incomeInputMode = body.incomeInputMode ?? current.incomeInputMode ?? "AMOUNT";
  if (incomeInputMode !== "RATE" && incomeInputMode !== "AMOUNT")
    throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ.", {
      incomeInputMode: "incomeInputMode chỉ có thể là RATE hoặc AMOUNT.",
    });
  let incomeAmount: number;
  let partnerReturnRateBps: number;
  if (incomeInputMode === "RATE") {
    partnerReturnRateBps = integer(
      body.partnerReturnRateBps ?? current.partnerReturnRateBps ?? 0,
      "partnerReturnRateBps",
      0,
      10000,
    );
    incomeAmount = Math.round((outcomeAmount * partnerReturnRateBps) / 10000);
  } else {
    incomeAmount = integer(
      body.incomeAmount ?? current.incomeAmount ?? 0,
      "incomeAmount",
      0,
    );
    partnerReturnRateBps = Math.round((incomeAmount * 10000) / outcomeAmount);
  }
  if (incomeAmount > outcomeAmount)
    throw new ApiError(
      400,
      "INVALID_INCOME_AMOUNT",
      "Số tiền đối tác hoàn lại không hợp lệ.",
    );
  const note = body.note ?? current.note ?? "";
  if (typeof note !== "string" || note.trim().length > 1000)
    throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ.");
  const eligible =
    body.eligibleForAnnualFeeWaiver ??
    current.eligibleForAnnualFeeWaiver ??
    true;
  if (typeof eligible !== "boolean")
    throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ.");
  return {
    transactionDate,
    outcomeAmount,
    incomeAmount,
    partnerReturnRateBps,
    incomeInputMode,
    cashbackRateBps: integer(
      body.cashbackRateBps ?? current.cashbackRateBps ?? 0,
      "cashbackRateBps",
      0,
      10000,
    ),
    eligibleForAnnualFeeWaiver: eligible,
    note: note.trim(),
  };
};
export const derived = (transaction: Data) => {
  const outcome = Number(transaction.outcomeAmount ?? 0);
  const income = Number(transaction.incomeAmount ?? 0);
  const serviceFee = outcome - income;
  const cashbackByRateAmount = Math.round(
    (outcome * Number(transaction.cashbackRateBps ?? 0)) / 10000,
  );
  const received = transaction.cashbackStatus === "RECEIVED";
  const actualCashbackAmount = received
    ? Number(transaction.actualCashbackAmount ?? 0)
    : 0;
  return {
    serviceFee,
    cashbackByRateAmount,
    expectedCashbackAmount: cashbackByRateAmount,
    eligibleCashbackAmount: cashbackByRateAmount,
    exceededCashbackAmount: 0,
    expectedNetProfit: cashbackByRateAmount - serviceFee,
    actualCashbackAmount,
    actualNetProfit:
      transaction.cashbackStatus === "PENDING"
        ? null
        : actualCashbackAmount - serviceFee,
  };
};
type TransactionTotals = {
  totalOutcome: number;
  totalIncome: number;
  totalServiceFee: number;
  cashbackByRate: number;
  actualCashback: number;
  annualEligibleSpend: number;
  transactionCount: number;
};

export const summarize = (transactions: Data[], capValue: unknown = null) => {
  const base = transactions.reduce<TransactionTotals>(
    (sum, item) => {
      const values = derived(item);
      const outcome = Number(item.outcomeAmount ?? 0);
      return {
        totalOutcome: sum.totalOutcome + outcome,
        totalIncome: sum.totalIncome + Number(item.incomeAmount ?? 0),
        totalServiceFee: sum.totalServiceFee + values.serviceFee,
        cashbackByRate: sum.cashbackByRate + values.cashbackByRateAmount,
        actualCashback: sum.actualCashback + values.actualCashbackAmount,
        annualEligibleSpend:
          sum.annualEligibleSpend +
          (item.eligibleForAnnualFeeWaiver === false ? 0 : outcome),
        transactionCount: sum.transactionCount + 1,
      };
    },
    {
      totalOutcome: 0,
      totalIncome: 0,
      totalServiceFee: 0,
      cashbackByRate: 0,
      actualCashback: 0,
      annualEligibleSpend: 0,
      transactionCount: 0,
    },
  );
  const cap =
    typeof capValue === "number" && capValue >= 0 ? Math.round(capValue) : null;
  const eligibleCashback =
    cap === null ? base.cashbackByRate : Math.min(base.cashbackByRate, cap);
  const actualCashback =
    cap === null ? base.actualCashback : Math.min(base.actualCashback, cap);
  const exceededCashback = Math.max(
    base.cashbackByRate - (cap ?? base.cashbackByRate),
    0,
  );
  const remainingCashback =
    cap === null ? null : Math.max(cap - eligibleCashback, 0);
  const capUsedPercent =
    cap === null
      ? null
      : cap > 0
        ? Math.round((eligibleCashback * 10000) / cap) / 100
        : 100;
  return {
    ...base,
    actualCashback,
    expectedCashback: eligibleCashback,
    eligibleCashback,
    exceededCashback,
    remainingCashback,
    cashbackCap: {
      capAmount: cap,
      unlimited: cap === null,
      cashbackByRate: base.cashbackByRate,
      eligibleCashback,
      actualCashback,
      exceededCashback,
      remainingCashback,
      capUsedPercent,
    },
    expectedNetProfit: eligibleCashback - base.totalServiceFee,
    actualNetProfit: actualCashback - base.totalServiceFee,
    totalAmountDue: base.totalOutcome,
  };
};

export type StoredPaymentStatus = "OPEN" | "STATEMENT_CLOSED" | "PAID" | "OVERDUE";
export type EffectivePaymentStatus = StoredPaymentStatus;

export const isPaid = (statement: Data) => statement.paymentStatus === "PAID";
export const isUnpaid = (statement: Data) => !isPaid(statement);
export const isOverdue = (statement: Data, today = new Date().toISOString().slice(0, 10)) =>
  isUnpaid(statement) &&
  typeof statement.paymentDueDate === "string" &&
  statement.paymentDueDate < today;
export const effectivePaymentStatus = (statement: Data, today = new Date().toISOString().slice(0, 10)): EffectivePaymentStatus =>
  isOverdue(statement, today) ? "OVERDUE" : String(statement.paymentStatus ?? "OPEN") as EffectivePaymentStatus;
