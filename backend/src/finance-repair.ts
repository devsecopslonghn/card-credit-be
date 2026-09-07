export type RepairAccount = { _id: unknown; workspaceId?: unknown; type?: unknown; active?: unknown; openingBalance?: unknown };
export type RepairTransaction = { _id: unknown; workspaceId?: unknown; accountId?: unknown; accountType?: unknown; transactionType?: unknown; targetMetric?: unknown; receivableStatus?: unknown; ownership?: unknown; amount?: unknown; reimbursementExpected?: unknown; serviceFeeRate?: unknown; statementId?: unknown; reimbursementForTransactionId?: unknown; personalSpending?: unknown; debitCashflow?: unknown; creditDebt?: unknown; outstandingReceivable?: unknown; transactionDate?: unknown; note?: unknown };
export type RepairStatement = { _id: unknown; paymentStatus?: unknown; paidAmount?: unknown; summary?: { outstandingAmount?: unknown; paymentAmount?: unknown } };
const id = (value: unknown) => String(value ?? "");
const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const technicalTypes = new Set(["BALANCE_ADJUSTMENT", "OPENING_BALANCE_ADJUSTMENT"]);

export type FinanceReconciliation = {
  from: string; to: string; transactionCount: number; activeRealMoney: number;
  activeCashBalance: number; activeBankBalance: number; outstandingReceivable: number;
  currentCardDebt: number; paidStatementDebt: number; realIncome: number;
  personalSpending: number; operatingCashflow: number; technicalAdjustments: number; netAssets: number;
};

export const reconcileFinanceMonth = (accounts: RepairAccount[], transactions: RepairTransaction[], statements: RepairStatement[], range: { from: string; to: string }): FinanceReconciliation => {
  const active = accounts.filter((account) => account.active !== false);
  const activeMoney = active.filter((account) => ["CASH", "DEBIT", "E_WALLET"].includes(String(account.type)));
  const inRange = transactions.filter((tx) => String(tx.transactionDate ?? "") >= range.from && String(tx.transactionDate ?? "") <= range.to);
  const cashflowByAccount = new Map<string, number>();
  for (const tx of transactions) cashflowByAccount.set(id(tx.accountId), (cashflowByAccount.get(id(tx.accountId)) ?? 0) + n(tx.debitCashflow));
  const balance = (account: RepairAccount) => n(account.openingBalance) + (cashflowByAccount.get(id(account._id)) ?? 0);
  const activeRealMoney = activeMoney.reduce((sum, account) => sum + balance(account), 0);
  const activeCashBalance = activeMoney.filter((account) => account.type === "CASH").reduce((sum, account) => sum + balance(account), 0);
  const activeBankBalance = activeMoney.filter((account) => account.type === "DEBIT").reduce((sum, account) => sum + balance(account), 0);
  const sourceReceivable = new Map<string, number>();
  for (const tx of transactions) if (tx.transactionType === "EXPENSE" && tx.ownership === "PAID_FOR_OTHER") sourceReceivable.set(id(tx._id), Math.max(0, n(tx.reimbursementExpected ?? tx.outstandingReceivable)));
  for (const tx of transactions) if (tx.transactionType === "REIMBURSEMENT" && tx.reimbursementForTransactionId) sourceReceivable.set(id(tx.reimbursementForTransactionId), Math.max(0, (sourceReceivable.get(id(tx.reimbursementForTransactionId)) ?? 0) - n(tx.amount)));
  const outstandingReceivable = [...sourceReceivable.values()].reduce((sum, value) => sum + value, 0);
  const currentCardDebt = statements.reduce((sum, statement) => sum + Math.max(0, n(statement.summary?.outstandingAmount)), 0);
  const paidStatementDebt = statements.reduce((sum, statement) => sum + Math.max(0, n(statement.summary?.paymentAmount)), 0);
  const realIncome = inRange.filter((tx) => tx.transactionType === "INCOME").reduce((sum, tx) => sum + Math.max(0, n(tx.amount)), 0);
  const personalSpending = inRange.reduce((sum, tx) => sum + n(tx.personalSpending), 0);
  const operatingCashflow = inRange.filter((tx) => !technicalTypes.has(String(tx.transactionType))).reduce((sum, tx) => sum + n(tx.debitCashflow), 0);
  const technicalAdjustments = inRange.filter((tx) => technicalTypes.has(String(tx.transactionType))).reduce((sum, tx) => sum + n(tx.amount), 0);
  return { ...range, transactionCount: inRange.length, activeRealMoney, activeCashBalance, activeBankBalance, outstandingReceivable, currentCardDebt, paidStatementDebt, realIncome, personalSpending, operatingCashflow, technicalAdjustments, netAssets: activeRealMoney + outstandingReceivable - currentCardDebt };
};

export const inspectFinanceRepair = (accounts: RepairAccount[], transactions: RepairTransaction[], statements: RepairStatement[]) => {
  const accountById = new Map(accounts.map((account) => [id(account._id), account]));
  const staleAccountType = transactions.filter((tx) => {
    const accountType = accountById.get(id(tx.accountId))?.type;
    return accountType && String(tx.accountType) !== String(accountType);
  }).map((tx) => ({ transactionId: id(tx._id), accountId: id(tx.accountId), stored: String(tx.accountType), expected: String(accountById.get(id(tx.accountId))?.type) }));
  const duplicateGroups = new Map<string, string[]>();
  for (const tx of transactions) {
    const fingerprint = JSON.stringify({ workspaceId: id(tx.workspaceId), accountId: id(tx.accountId), transactionType: tx.transactionType, amount: n(tx.amount), statementId: id(tx.statementId), reimbursementForTransactionId: id(tx.reimbursementForTransactionId), debitCashflow: n(tx.debitCashflow), creditDebt: n(tx.creditDebt), transactionDate: (tx as Record<string, unknown>).transactionDate });
    const group = duplicateGroups.get(fingerprint) ?? []; group.push(id(tx._id)); duplicateGroups.set(fingerprint, group);
  }
  const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1);
  const technicalIncome = transactions.filter((tx) => tx.transactionType === "INCOME" && /adjust|opening|số dư|so du/i.test(String((tx as Record<string, unknown>).note ?? ""))).map((tx) => id(tx._id));
  const technicalAdjustmentFees = transactions.filter((tx) => technicalTypes.has(String(tx.transactionType)) && n(tx.serviceFeeRate) !== 0).map((tx) => ({ transactionId: id(tx._id), serviceFeeRate: n(tx.serviceFeeRate) }));
  const technicalAdjustmentTargetMetric = transactions.filter((tx) => technicalTypes.has(String(tx.transactionType)) && ((String(tx.accountType) === "CREDIT" && tx.targetMetric !== "currentDebt") || (String(tx.accountType) !== "CREDIT" && tx.targetMetric === "currentDebt"))).map((tx) => ({ transactionId: id(tx._id), accountType: tx.accountType, targetMetric: tx.targetMetric ?? null }));
  const adjustmentLikeWrongType = transactions.filter((tx) => !technicalTypes.has(String(tx.transactionType)) && /adjust|opening|số dư|so du/i.test(String(tx.note ?? ""))).map((tx) => ({ transactionId: id(tx._id), transactionType: String(tx.transactionType) }));
  const archivedBalances = accounts.filter((account) => account.active === false).map((account) => ({ accountId: id(account._id), openingBalance: n(account.openingBalance), ledgerBalance: transactions.filter((tx) => id(tx.accountId) === id(account._id)).reduce((sum, tx) => sum + n(tx.debitCashflow), 0) })).filter((item) => item.openingBalance !== 0 || item.ledgerBalance !== 0);
  const reimbursementOnPaidStatement = statements.filter((statement) => statement.paymentStatus === "PAID").map((statement) => {
    const statementTransactions = transactions.filter((tx) => id(tx.statementId) === id(statement._id));
    const sourceIds = new Set(statementTransactions.filter((tx) => tx.transactionType === "EXPENSE" && tx.ownership === "PAID_FOR_OTHER").map((tx) => id(tx._id)));
    const received = transactions.filter((tx) => tx.transactionType === "REIMBURSEMENT" && sourceIds.has(id(tx.reimbursementForTransactionId))).reduce((sum, tx) => sum + n(tx.amount), 0);
    return { statementId: id(statement._id), reimbursementReceived: received };
  }).filter((item) => item.reimbursementReceived > 0);
  const paidStatementConflicts = statements.filter((statement) => statement.paymentStatus === "PAID").map((statement) => {
    const ledger = transactions.filter((tx) => id(tx.statementId) === id(statement._id));
    const gross = ledger.reduce((sum, tx) => sum + Math.max(0, n(tx.creditDebt)), 0);
    const paid = ledger.reduce((sum, tx) => sum + (tx.transactionType === "STATEMENT_PAYMENT" ? Math.max(0, n(tx.amount)) : Math.max(0, -n(tx.creditDebt))), 0);
    return { statementId: id(statement._id), outstandingAmount: Math.max(n(statement.summary?.outstandingAmount), gross - paid), paidAmount: n(statement.paidAmount), ledgerPaymentAmount: paid };
  }).filter((item) => item.outstandingAmount > 0 || (item.paidAmount > 0 && item.ledgerPaymentAmount === 0));
  return { counts: { accounts: accounts.length, transactions: transactions.length, statements: statements.length }, staleAccountType, duplicates, technicalIncome, technicalAdjustmentFees, technicalAdjustmentTargetMetric, adjustmentLikeWrongType, archivedBalances, paidStatementConflicts, reimbursementOnPaidStatement, writeRequired: staleAccountType.length + duplicates.length + technicalIncome.length + technicalAdjustmentFees.length + technicalAdjustmentTargetMetric.length + adjustmentLikeWrongType.length + archivedBalances.length + paidStatementConflicts.length + reimbursementOnPaidStatement.length > 0 };
};
