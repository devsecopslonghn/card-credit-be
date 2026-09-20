const accountTypes = new Set(["DEBIT", "CASH", "E_WALLET", "CREDIT"]);

export type CanonicalAccountRecord = {
  _id: unknown;
  type?: unknown;
};

export type CanonicalTransactionRecord = {
  _id: unknown;
  accountId?: unknown;
  accountType?: unknown;
  transactionType?: unknown;
  ownership?: unknown;
  amount?: unknown;
  reimbursementExpected?: unknown;
  outstandingReceivable?: unknown;
  receivableStatus?: unknown;
  receivableSettledAmount?: unknown;
  reimbursementForTransactionId?: unknown;
  voidedAt?: unknown;
};

export type AccountTypeUpdate = {
  transactionId: string;
  accountType: string;
  previousAccountType: string;
};

export type ReceivableUpdate = {
  transactionId: string;
  outstandingReceivable: number;
  previousOutstandingReceivable: number;
};

export type CanonicalFinancePlan = {
  accountTypeUpdates: AccountTypeUpdate[];
  receivableUpdates: ReceivableUpdate[];
  unresolvedAccountReferences: string[];
};

const idOf = (value: unknown) => String(value ?? "");
const numberOf = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const hasValue = (value: unknown) => value !== undefined && value !== null;

/**
 * Build a deterministic, write-free repair plan for the canonical finance fields.
 * Accounts are the source of truth for accountType; linked reimbursements and
 * settlement metadata determine the current receivable balance.
 */
export const buildCanonicalFinancePlan = (
  accounts: CanonicalAccountRecord[],
  transactions: CanonicalTransactionRecord[],
): CanonicalFinancePlan => {
  const accountTypeById = new Map<string, string>();
  for (const account of accounts) {
    const type = String(account.type ?? "");
    if (accountTypes.has(type)) accountTypeById.set(idOf(account._id), type);
  }

  const accountTypeUpdates: AccountTypeUpdate[] = [];
  const unresolvedAccountReferences = new Set<string>();
  for (const transaction of transactions) {
    const transactionId = idOf(transaction._id);
    const accountId = idOf(transaction.accountId);
    const expectedType = accountTypeById.get(accountId);
    if (!expectedType) {
      unresolvedAccountReferences.add(accountId);
      continue;
    }
    const previousAccountType = String(transaction.accountType ?? "");
    if (previousAccountType !== expectedType) accountTypeUpdates.push({ transactionId, accountType: expectedType, previousAccountType });
  }

  const activeTransactions = transactions.filter((transaction) => !transaction.voidedAt);
  const sources = activeTransactions.filter((transaction) => transaction.transactionType === "EXPENSE" && transaction.ownership === "PAID_FOR_OTHER");
  const collectedBySource = new Map<string, number>();
  for (const reimbursement of activeTransactions) {
    if (reimbursement.transactionType !== "REIMBURSEMENT" || !reimbursement.reimbursementForTransactionId) continue;
    const sourceId = idOf(reimbursement.reimbursementForTransactionId);
    collectedBySource.set(sourceId, (collectedBySource.get(sourceId) ?? 0) + Math.max(0, numberOf(reimbursement.amount)));
  }
  for (const source of sources) {
    if (!["SETTLED", "COLLECTED"].includes(String(source.receivableStatus))) continue;
    const sourceId = idOf(source._id);
    collectedBySource.set(sourceId, Math.max(
      collectedBySource.get(sourceId) ?? 0,
      numberOf(source.receivableSettledAmount ?? source.reimbursementExpected),
    ));
  }

  const receivableUpdates: ReceivableUpdate[] = [];
  for (const source of sources) {
    if (!hasValue(source.reimbursementExpected) && !hasValue(source.outstandingReceivable)) continue;
    const gross = Math.max(0, numberOf(source.reimbursementExpected ?? source.outstandingReceivable));
    const collected = Math.max(0, collectedBySource.get(idOf(source._id)) ?? 0);
    const outstandingReceivable = Math.max(0, gross - collected);
    const previousOutstandingReceivable = numberOf(source.outstandingReceivable);
    if (previousOutstandingReceivable !== outstandingReceivable) receivableUpdates.push({ transactionId: idOf(source._id), outstandingReceivable, previousOutstandingReceivable });
  }

  return { accountTypeUpdates, receivableUpdates, unresolvedAccountReferences: [...unresolvedAccountReferences].filter(Boolean).sort() };
};
