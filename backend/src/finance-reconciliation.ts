import { canonicalPayloadHash } from "./command-hash.js";

type Data = Record<string, unknown>;

export type LegacyPaymentStatement = Data & {
  _id: unknown;
  paymentStatus?: unknown;
  paidAmount?: unknown;
  paidAt?: unknown;
};

export type LegacyPaymentTransaction = Data & {
  _id: unknown;
  statementId?: unknown;
  transactionType?: unknown;
  amount?: unknown;
  creditDebt?: unknown;
  debitCashflow?: unknown;
  personalSpending?: unknown;
  accountId?: unknown;
  accountType?: unknown;
  ownership?: unknown;
  reimbursementExpected?: unknown;
  serviceFeeRate?: unknown;
  refundReceived?: unknown;
  cashbackReceived?: unknown;
  outstandingReceivable?: unknown;
  reimbursementReceived?: unknown;
  createdAt?: unknown;
  transactionDate?: unknown;
};

export type LegacyPaymentAccount = Data & {
  _id: unknown;
  type?: unknown;
  active?: unknown;
};

export type LegacyPaymentRepair = {
  statementId: string;
  transactionId: string;
  accountId: string;
  amount: number;
  previousStatus: string;
  paidAt: Date;
};

export type LegacyPaymentSkip = {
  statementId: string;
  reason: string;
  transactionIds: string[];
};

export type LegacyPaymentPlan = {
  repairs: LegacyPaymentRepair[];
  skipped: LegacyPaymentSkip[];
  sourceHash: string;
};

export type OrphanReferenceKind =
  | "STATEMENT_CARD"
  | "ACCOUNT_CARD"
  | "TRANSACTION_ACCOUNT"
  | "TRANSACTION_STATEMENT"
  | "FEE_CARD"
  | "CASHBACK_CARD";

export type OrphanReference = {
  kind: OrphanReferenceKind;
  recordId: string;
  referenceId: string;
};

export type OrphanReconciliation = {
  counts: Record<OrphanReferenceKind, number>;
  records: OrphanReference[];
  sourceHash: string;
};

export const reconciliationIdOf = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if ("$value" in value && typeof value.$value === "string") return value.$value;
  return "toString" in value ? String(value) : "";
};
const isObjectId = (value: string) => /^[a-f0-9]{24}$/i.test(value);
const numberOf = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const dateOf = (value: unknown) => {
  const date = value instanceof Date ? new Date(value.valueOf()) : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.valueOf()) ? date : null;
};
const transactionDateOf = (transaction: LegacyPaymentTransaction) => dateOf(transaction.createdAt) ?? dateOf(`${String(transaction.transactionDate ?? "")}T00:00:00.000Z`);

const idOf = reconciliationIdOf;
const skip = (statementId: string, reason: string, transactions: LegacyPaymentTransaction[]): LegacyPaymentSkip => ({
  statementId,
  reason,
  transactionIds: transactions.map((transaction) => idOf(transaction._id)).filter(Boolean),
});

const isoOrNull = (value: unknown) => {
  const date = dateOf(value);
  return date ? date.toISOString() : null;
};

const sourceFingerprint = (
  statements: LegacyPaymentStatement[],
  transactions: LegacyPaymentTransaction[],
  accounts: LegacyPaymentAccount[],
  repairs: LegacyPaymentRepair[],
  skipped: LegacyPaymentSkip[],
) => {
  const statementIds = new Set([...repairs.map((item) => item.statementId), ...skipped.map((item) => item.statementId)]);
  const transactionIds = new Set([...repairs.map((item) => item.transactionId), ...skipped.flatMap((item) => item.transactionIds)]);
  const accountIds = new Set(transactions.filter((transaction) => transactionIds.has(idOf(transaction._id)) || statementIds.has(idOf(transaction.statementId))).map((transaction) => idOf(transaction.accountId)).filter(Boolean));
  return {
    statements: statements.filter((statement) => statementIds.has(idOf(statement._id))).map((statement) => ({ id: idOf(statement._id), paymentStatus: statement.paymentStatus ?? null, paidAmount: numberOf(statement.paidAmount), paidAt: isoOrNull(statement.paidAt) })).sort((left, right) => left.id.localeCompare(right.id)),
    transactions: transactions.filter((transaction) => transactionIds.has(idOf(transaction._id)) || statementIds.has(idOf(transaction.statementId))).map((transaction) => ({ id: idOf(transaction._id), statementId: idOf(transaction.statementId), transactionType: transaction.transactionType ?? null, amount: numberOf(transaction.amount), creditDebt: numberOf(transaction.creditDebt), debitCashflow: numberOf(transaction.debitCashflow), personalSpending: numberOf(transaction.personalSpending), accountId: idOf(transaction.accountId), createdAt: isoOrNull(transaction.createdAt), transactionDate: transaction.transactionDate ?? null })).sort((left, right) => left.id.localeCompare(right.id)),
    accounts: accounts.filter((account) => accountIds.has(idOf(account._id))).map((account) => ({ id: idOf(account._id), type: account.type ?? null, active: account.active ?? null })).sort((left, right) => left.id.localeCompare(right.id)),
  };
};

export const reconciliationPlanPayload = (plan: LegacyPaymentPlan) => ({
  repairs: plan.repairs.map((repair) => ({ ...repair, paidAt: repair.paidAt.toISOString() })),
  skipped: plan.skipped,
});

export const reconciliationPlanHash = (plan: LegacyPaymentPlan) => canonicalPayloadHash(reconciliationPlanPayload(plan));

/**
 * Builds a deterministic, read-only inventory of broken workspace references.
 * It intentionally reports only non-empty references that point outside the
 * supplied parent sets; it never repairs, deletes or reassigns financial data.
 */
export const auditOrphanReferences = (input: {
  cards: Data[];
  statements: Data[];
  accounts: Data[];
  transactions: Data[];
  fees: Data[];
  cashbacks: Data[];
}): OrphanReconciliation => {
  const ids = (items: Data[]) => new Set(items.map((item) => idOf(item._id)).filter(Boolean));
  const cardIds = ids(input.cards);
  const statementIds = ids(input.statements);
  const accountIds = ids(input.accounts);
  const records: OrphanReference[] = [];
  const add = (kind: OrphanReferenceKind, record: Data, reference: unknown) => {
    const recordId = idOf(record._id);
    const referenceId = idOf(reference);
    if (recordId && referenceId) records.push({ kind, recordId, referenceId });
  };
  for (const statement of input.statements) if (idOf(statement.userCardId) && !cardIds.has(idOf(statement.userCardId))) add("STATEMENT_CARD", statement, statement.userCardId);
  for (const account of input.accounts) if (idOf(account.creditCardId) && !cardIds.has(idOf(account.creditCardId))) add("ACCOUNT_CARD", account, account.creditCardId);
  for (const transaction of input.transactions) {
    if (idOf(transaction.accountId) && !accountIds.has(idOf(transaction.accountId))) add("TRANSACTION_ACCOUNT", transaction, transaction.accountId);
    if (idOf(transaction.statementId) && !statementIds.has(idOf(transaction.statementId))) add("TRANSACTION_STATEMENT", transaction, transaction.statementId);
  }
  for (const fee of input.fees) if (idOf(fee.userCardId) && !cardIds.has(idOf(fee.userCardId))) add("FEE_CARD", fee, fee.userCardId);
  for (const cashback of input.cashbacks) if (idOf(cashback.userCardId) && !cardIds.has(idOf(cashback.userCardId))) add("CASHBACK_CARD", cashback, cashback.userCardId);
  records.sort((left, right) => left.kind.localeCompare(right.kind) || left.recordId.localeCompare(right.recordId) || left.referenceId.localeCompare(right.referenceId));
  const kinds: OrphanReferenceKind[] = ["STATEMENT_CARD", "ACCOUNT_CARD", "TRANSACTION_ACCOUNT", "TRANSACTION_STATEMENT", "FEE_CARD", "CASHBACK_CARD"];
  const counts = Object.fromEntries(kinds.map((kind) => [kind, records.filter((record) => record.kind === kind).length])) as Record<OrphanReferenceKind, number>;
  return { counts, records, sourceHash: canonicalPayloadHash(records) };
};

/**
 * Plans only deterministic state repairs where the existing ledger proves that
 * one real-money statement payment fully settles one non-PAID statement.
 * The planner never mutates persistence and is intentionally strict: any
 * ambiguity is reported as skipped for operator review.
 */
export const planLegacyStatementPaymentRepairs = (
  statements: LegacyPaymentStatement[],
  transactions: LegacyPaymentTransaction[],
  accounts: LegacyPaymentAccount[],
): LegacyPaymentPlan => {
  const transactionsByStatement = new Map<string, LegacyPaymentTransaction[]>();
  for (const transaction of transactions) {
    const statementId = idOf(transaction.statementId);
    if (!statementId) continue;
    const group = transactionsByStatement.get(statementId) ?? [];
    group.push(transaction);
    transactionsByStatement.set(statementId, group);
  }
  const eligibleAccounts = new Set(accounts.filter((account) => account.active !== false && ["DEBIT", "CASH", "E_WALLET"].includes(String(account.type))).map((account) => idOf(account._id)).filter(Boolean));
  const repairs: LegacyPaymentRepair[] = [];
  const skipped: LegacyPaymentSkip[] = [];

  for (const statement of statements) {
    const statementId = idOf(statement._id);
    if (!statementId) continue;
    const statementTransactions = transactionsByStatement.get(statementId) ?? [];
    const paymentTransactions = statementTransactions.filter((transaction) => transaction.transactionType === "STATEMENT_PAYMENT");
    if (!paymentTransactions.length) continue;
    const status = typeof statement.paymentStatus === "string" ? statement.paymentStatus : "";
    if (status === "PAID") continue;
    if (!isObjectId(statementId)) {
      skipped.push(skip(statementId, "STATEMENT_ID_INVALID", paymentTransactions));
      continue;
    }
    if (!["OPEN", "STATEMENT_CLOSED"].includes(status)) {
      skipped.push(skip(statementId, "STATEMENT_STATUS_UNSUPPORTED", paymentTransactions));
      continue;
    }
    if (paymentTransactions.length !== 1) {
      skipped.push(skip(statementId, "MULTIPLE_STATEMENT_PAYMENTS", paymentTransactions));
      continue;
    }
    if (statement.paidAt || (numberOf(statement.paidAmount) ?? 0) > 0) {
      skipped.push(skip(statementId, "STATEMENT_HAS_PAID_METADATA", paymentTransactions));
      continue;
    }
    const [payment] = paymentTransactions;
    if (!payment) continue;
    const accountId = idOf(payment.accountId);
    const amount = numberOf(payment.amount);
    if (!isObjectId(idOf(payment._id))) {
      skipped.push(skip(statementId, "TRANSACTION_ID_INVALID", paymentTransactions));
      continue;
    }
    if (!isObjectId(accountId) || !eligibleAccounts.has(accountId)) {
      skipped.push(skip(statementId, "PAYMENT_ACCOUNT_NOT_ACTIVE_REAL_MONEY", paymentTransactions));
      continue;
    }
    const account = accounts.find((item) => idOf(item._id) === accountId);
    const optionalImpactFields = [payment.reimbursementExpected, payment.serviceFeeRate, payment.refundReceived, payment.cashbackReceived, payment.outstandingReceivable, payment.reimbursementReceived];
    if (String(payment.accountType ?? "") !== String(account?.type ?? "") || String(payment.ownership ?? "PERSONAL") !== "PERSONAL" || optionalImpactFields.some((value) => (numberOf(value) ?? 0) !== 0)) {
      skipped.push(skip(statementId, "LEDGER_IMPACT_NOT_CANONICAL", paymentTransactions));
      continue;
    }
    if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) {
      skipped.push(skip(statementId, "PAYMENT_AMOUNT_INVALID", paymentTransactions));
      continue;
    }
    const chargeDebt = statementTransactions
      .filter((transaction) => transaction !== payment)
      .reduce((total, transaction) => total + Math.max(numberOf(transaction.creditDebt) ?? 0, 0), 0);
    const creditDebt = numberOf(payment.creditDebt);
    const debitCashflow = numberOf(payment.debitCashflow);
    const personalSpending = numberOf(payment.personalSpending);
    if (chargeDebt !== amount || creditDebt !== -amount || debitCashflow !== -amount || personalSpending !== 0) {
      skipped.push(skip(statementId, "LEDGER_IMPACT_DOES_NOT_FULLY_SETTLE_STATEMENT", paymentTransactions));
      continue;
    }
    const paidAt = transactionDateOf(payment);
    if (!paidAt) {
      skipped.push(skip(statementId, "PAYMENT_DATE_INVALID", paymentTransactions));
      continue;
    }
    repairs.push({ statementId, transactionId: idOf(payment._id), accountId, amount, previousStatus: status, paidAt });
  }
  return { repairs, skipped, sourceHash: canonicalPayloadHash(sourceFingerprint(statements, transactions, accounts, repairs, skipped)) };
};
