import mongoose from "mongoose";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { AccountModel } from "../models/account.js";
import { CardFeePaymentModel } from "../models/card-fee-payment.js";
import { MonthlyCardCashbackModel } from "../models/monthly-card-cashback.js";
import { CardStatementModel } from "../models/card-statement.js";
import { CreditCardModel } from "../models/credit-card.js";
import type { ServiceContext } from "./types/service-context.js";
import { ApiError } from "../errors.js";
import { StatementQueryService } from "./statement-query-service.js";
import { creditDebtLedgerListSchema, financialReportSchema, reportDateRangeSchema } from "@card-credit/contracts";
import type { FinancialReportDto } from "@card-credit/contracts";

type Range = { from: string; to: string };
type Data = Record<string, unknown>;
const REPORT_CURSOR_BATCH_SIZE = 100;
const technicalTypes = new Set(["BALANCE_ADJUSTMENT", "OPENING_BALANCE_ADJUSTMENT"]);

/** Consume a complete report source with a bounded Mongo cursor when available. */
export const readReportCollection = async <T>(query: unknown): Promise<T[]> => {
  const source = query as { lean?: () => unknown };
  const leanQuery = typeof source?.lean === "function" ? source.lean() : query;
  const cursorSource = leanQuery as { cursor?: (options?: { batchSize?: number }) => AsyncIterable<T> };
  if (typeof cursorSource?.cursor === "function") {
    const values: T[] = [];
    for await (const value of cursorSource.cursor({ batchSize: REPORT_CURSOR_BATCH_SIZE })) values.push(value);
    return values;
  }
  return await leanQuery as T[];
};

const empty = () => ({ personalSpending: 0, debitCashflow: 0, creditDebt: 0, outstandingReceivable: 0, reimbursementReceived: 0, transactionCount: 0 });
const emptyTotals = () => ({
  ...empty(),
  totalServiceFee: 0,
  transactionCashbackActual: 0,
  monthlyBankCashbackExpected: 0,
  monthlyBankCashbackActual: 0,
  monthlyBankCashbackRejected: 0,
  totalPaidCardFees: 0,
  actualNetBenefit: 0,
  activeCashBalance: 0,
  activeBankBalance: 0,
  currentCardDebt: 0,
  paidStatementDebt: 0,
  grossReceivable: 0,
  collectedReceivable: 0,
  paidStatementReceivable: 0,
  realIncome: 0,
  technicalAdjustments: 0,
  operatingCashflow: 0,
});

const add = (target: ReturnType<typeof empty>, item: Record<string, unknown>) => {
  const technical = technicalTypes.has(String(item.transactionType));
  if (!technical) {
    target.personalSpending += Number(item.personalSpending ?? 0);
    target.debitCashflow += Number(item.debitCashflow ?? 0);
    target.creditDebt += Number(item.creditDebt ?? 0);
    target.outstandingReceivable += Number(item.outstandingReceivable ?? 0);
    target.reimbursementReceived += Number(item.reimbursementReceived ?? 0);
  }
  target.transactionCount += 1;
};

export class FinancialReportService {
  static async statementSummary(ctx: ServiceContext, statementId: string) {
    return StatementQueryService.getById(ctx, statementId);
  }

  static async upcomingStatements(ctx: ServiceContext, limit = 20) {
    return StatementQueryService.upcoming(ctx, limit);
  }

  /**
   * Return the canonical debt ledger by card statement. A paid statement remains
   * visible: grossDebt is the original charge, paidDebt is the settled amount,
   * and outstandingDebt is what remains payable.
   */
  static async creditDebtLedger(ctx: ServiceContext, range: Range, filters: { cardId?: string; owner?: string } = {}) {
    range = reportDateRangeSchema.parse(range) as Range;
    if (filters.cardId && !mongoose.isValidObjectId(filters.cardId)) throw new ApiError(400, "INVALID_REPORT_FILTER", "Bộ lọc thẻ không hợp lệ.");
    const cards = await readReportCollection<Data>(CreditCardModel.find({
      workspaceId: ctx.workspaceId,
      ...(filters.cardId ? { _id: filters.cardId } : {}),
      ...(filters.owner ? { owner: filters.owner.trim() } : {}),
    }).select({ _id: 1, providerName: 1, displayName: 1, bank: 1, name: 1, owner: 1 }));
    if (filters.cardId && !cards.length) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const statements = await StatementQueryService.list(ctx, {
      statementDateFrom: range.from,
      statementDateTo: range.to,
      includeTransactions: false,
    });
    return creditDebtLedgerListSchema.parse(statements.flatMap((statement) => {
      const card = cardById.get(String(statement.cardId));
      if (!card) return [];
      return [{
        cardId: statement.cardId,
        statementId: statement.id,
        providerName: String(card.providerName ?? card.bank ?? ""),
        displayName: String(card.displayName ?? card.name ?? ""),
        owner: String(card.owner ?? "Tôi"),
        statementDate: statement.statementDate,
        paymentDueDate: statement.paymentDueDate,
        paymentStatus: statement.paymentStatus,
        grossDebt: statement.summary.statementAmount,
        paidDebt: statement.summary.paymentAmount,
        outstandingDebt: statement.summary.outstandingAmount,
        transactionCount: statement.summary.transactionCount,
      }];
    }));
  }

  static async summary(ctx: ServiceContext, range: Range, filters: { cardId?: string; owner?: string } = {}) {
    range = reportDateRangeSchema.parse(range) as Range;
    let transactionScope: Record<string, unknown> = { workspaceId: ctx.workspaceId, transactionDate: { $gte: range.from, $lte: range.to } };
    const accountScope: Record<string, unknown> = { workspaceId: ctx.workspaceId, active: { $ne: false } };
    const cardScope: Record<string, unknown> = { workspaceId: ctx.workspaceId };
    let cardAccountIds: unknown[] = [];
    let reportCardIds: unknown[] | null = null;
    if (filters.cardId || filters.owner) {
      if (filters.cardId && !mongoose.isValidObjectId(filters.cardId)) throw new ApiError(400, "INVALID_REPORT_FILTER", "Bộ lọc thẻ không hợp lệ.");
      const cards = await readReportCollection<Data>(CreditCardModel.find({
        ...cardScope,
        ...(filters.cardId ? { _id: filters.cardId } : {}),
        ...(filters.owner ? { owner: filters.owner.trim() } : {}),
      }).select({ _id: 1 }));
      if (filters.cardId && !cards.length) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
      reportCardIds = cards.map((card) => card._id);
      const [cardAccounts, cardStatements] = await Promise.all([
        readReportCollection<Data>(AccountModel.find({ ...accountScope, creditCardId: { $in: reportCardIds } }).select({ _id: 1 })),
        readReportCollection<Data>(CardStatementModel.find({ ...cardScope, userCardId: { $in: reportCardIds } }).select({ _id: 1 })),
      ]);
      cardAccountIds = cardAccounts.map((account) => account._id);
      transactionScope = { ...transactionScope, $or: [
        { accountId: { $in: cardAccountIds } },
        { statementId: { $in: cardStatements.map((statement) => statement._id) } },
      ] };
    }
    const [items, accounts, monthlyCashbacks, feePayments, allAccountTransactions, allStatements] = await Promise.all([
      readReportCollection<Data>(FinancialTransactionModel.find(transactionScope)),
      readReportCollection<Data>(AccountModel.find(accountScope)),
      readReportCollection<Data>(MonthlyCardCashbackModel.find({ workspaceId: ctx.workspaceId, ...(reportCardIds ? { userCardId: { $in: reportCardIds } } : {}), period: { $gte: range.from.slice(0, 7), $lte: range.to.slice(0, 7) } })),
      readReportCollection<Data>(CardFeePaymentModel.find({
        workspaceId: ctx.workspaceId,
        ...(reportCardIds ? { userCardId: { $in: reportCardIds } } : {}),
        paymentDate: { $gte: range.from, $lte: range.to },
        category: { $in: ["ANNUAL_CARD_FEE", "MANAGEMENT_FEE", "OTHER_FEE"] },
      })),
      readReportCollection<Data>(FinancialTransactionModel.find({ workspaceId: ctx.workspaceId })),
      StatementQueryService.list(ctx, { includeTransactions: false }),
    ]);
    const reportAccounts = reportCardIds
      ? accounts.filter((account) => cardAccountIds.some((id) => String(id) === String(account._id)) || items.some((item) => String(item.accountId) === String(account._id)))
      : accounts;
    const byCategory = new Map<string, ReturnType<typeof empty>>();
    const byAccountType = new Map<string, ReturnType<typeof empty>>();
    const accountNames = new Map(reportAccounts.map((account) => [String(account._id), String(account.name)]));
    const byAccount = new Map<string, ReturnType<typeof empty>>();
    for (const item of items) {
      const value = item as Record<string, unknown>;
      const category = String(value.categoryId ?? "OTHER");
      const categoryTotals = byCategory.get(category) ?? empty();
      add(categoryTotals, value);
      byCategory.set(category, categoryTotals);
      const type = String(value.accountType);
      const typeTotals = byAccountType.get(type) ?? empty();
      add(typeTotals, value);
      byAccountType.set(type, typeTotals);
      const accountId = String(value.accountId);
      const accountTotals = byAccount.get(accountId) ?? empty();
      add(accountTotals, value);
      byAccount.set(accountId, accountTotals);
    }
    const totals = emptyTotals();
    for (const item of items) add(totals, item as Record<string, unknown>);
    totals.totalServiceFee = items.reduce((sum, item) => {
      const value = item as Record<string, unknown>;
      if (value.transactionType !== "EXPENSE" || value.ownership !== "PAID_FOR_OTHER") return sum;
      return sum + Math.max(0, Number(value.amount ?? 0) - Number(value.reimbursementExpected ?? 0) - Number(value.refundReceived ?? 0));
    }, 0);
    totals.transactionCashbackActual = items.reduce((sum, item) => sum + Math.max(0, Number((item as Record<string, unknown>).cashbackReceived ?? 0)), 0);
    totals.monthlyBankCashbackExpected = monthlyCashbacks.reduce((sum, item) => sum + Math.max(0, Number((item as Record<string, unknown>).expectedAmount ?? 0)), 0);
    totals.monthlyBankCashbackActual = monthlyCashbacks.reduce((sum, item) => {
      const value = item as Record<string, unknown>;
      return sum + (value.status === "RECEIVED" ? Math.max(0, Number(value.actualAmount ?? 0)) : 0);
    }, 0);
    totals.monthlyBankCashbackRejected = monthlyCashbacks.reduce((sum, item) => {
      const value = item as Record<string, unknown>;
      return sum + (value.status === "REJECTED" ? Math.max(0, Number(value.expectedAmount ?? 0)) : 0);
    }, 0);
    const paidFeeCategories = new Set(["ANNUAL_CARD_FEE", "MANAGEMENT_FEE", "OTHER_FEE"]);
    totals.totalPaidCardFees = feePayments.reduce((sum, item) => {
      const value = item as Record<string, unknown>;
      return sum + (paidFeeCategories.has(String(value.category)) ? Math.max(0, Number(value.amount ?? 0)) : 0);
    }, 0);
    totals.actualNetBenefit = totals.monthlyBankCashbackActual - totals.totalServiceFee - totals.totalPaidCardFees;
    totals.realIncome = items.reduce((sum, item) => sum + (item.transactionType === "INCOME" ? Math.max(0, Number(item.amount ?? 0)) : 0), 0);
    totals.technicalAdjustments = allAccountTransactions.reduce((sum, item) => sum + (technicalTypes.has(String(item.transactionType)) ? Number(item.amount ?? 0) : 0), 0);
    totals.operatingCashflow = items.reduce((sum, item) => sum + (technicalTypes.has(String(item.transactionType)) ? 0 : Number(item.debitCashflow ?? 0)), 0);
    const sourceIds = items.filter((item) => item.transactionType === "EXPENSE" && item.ownership === "PAID_FOR_OTHER").map((item) => item._id);
    const reimbursements = sourceIds.length ? await readReportCollection<Data>(FinancialTransactionModel.find({ workspaceId: ctx.workspaceId, transactionType: "REIMBURSEMENT", reimbursementForTransactionId: { $in: sourceIds } }).select({ amount: 1 })) : [];
    totals.outstandingReceivable = Math.max(0, totals.outstandingReceivable - reimbursements.reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
    const creditDebtLedger = await this.creditDebtLedger(ctx, range, filters);
    const allCashflowByAccount = new Map<string, number>();
    for (const item of allAccountTransactions) allCashflowByAccount.set(String(item.accountId), (allCashflowByAccount.get(String(item.accountId)) ?? 0) + Number(item.debitCashflow ?? 0));
    const activeRealMoney = accounts.filter((account) => ["DEBIT", "CASH", "E_WALLET"].includes(String(account.type))).reduce((sum, account) => sum + Number(account.openingBalance ?? 0) + (allCashflowByAccount.get(String(account._id)) ?? 0), 0);
    totals.activeCashBalance = accounts.filter((account) => String(account.type) === "CASH").reduce((sum, account) => sum + Number(account.openingBalance ?? 0) + (allCashflowByAccount.get(String(account._id)) ?? 0), 0);
    totals.activeBankBalance = accounts.filter((account) => String(account.type) === "DEBIT").reduce((sum, account) => sum + Number(account.openingBalance ?? 0) + (allCashflowByAccount.get(String(account._id)) ?? 0), 0);
    const technicalDebtDelta = allAccountTransactions
      .filter((item) => String(item.accountType) === "CREDIT" && technicalTypes.has(String(item.transactionType)))
      .reduce((sum, item) => sum + Number(item.technicalDelta ?? 0), 0);
    totals.currentCardDebt = Math.max(0, allStatements.reduce((sum, statement) => sum + Math.max(0, Number(statement.summary?.outstandingAmount ?? 0)), 0) + technicalDebtDelta);
    totals.paidStatementDebt = allStatements.reduce((sum, statement) => sum + Math.max(0, Number(statement.summary?.paymentAmount ?? 0)), 0);
    const grossReceivableBySource = new Map<string, number>();
    const openReceivableBySource = new Map<string, number>();
    const sourceStatementById = new Map<string, string>();
    for (const item of allAccountTransactions) {
      if (item.transactionType !== "EXPENSE" || item.ownership !== "PAID_FOR_OTHER") continue;
      // reimbursementExpected is the gross claim. The retained impact field
      // may be stale after historical repairs, so it is only a legacy fallback.
      const sourceId = String(item._id);
      // `outstandingReceivable` is a historical calculated impact and is not a
      // current receivable source. Only the source claim is valid for audit.
      const gross = Math.max(0, Number(item.reimbursementExpected ?? 0));
      grossReceivableBySource.set(sourceId, gross);
      if (!["SETTLED", "COLLECTED"].includes(String(item.receivableStatus))) openReceivableBySource.set(sourceId, gross);
      if (item.statementId) sourceStatementById.set(String(item._id), String(item.statementId));
    }
    const collectedBySource = new Map<string, number>();
    for (const item of allAccountTransactions) if (item.transactionType === "REIMBURSEMENT" && item.reimbursementForTransactionId) {
      const sourceId = String(item.reimbursementForTransactionId);
      collectedBySource.set(sourceId, (collectedBySource.get(sourceId) ?? 0) + Math.max(0, Number(item.amount ?? item.reimbursementReceived ?? 0)));
    }
    for (const item of allAccountTransactions) {
      if (item.transactionType !== "EXPENSE" || item.ownership !== "PAID_FOR_OTHER" || !["SETTLED", "COLLECTED"].includes(String(item.receivableStatus))) continue;
      const sourceId = String(item._id);
      collectedBySource.set(sourceId, Math.max(collectedBySource.get(sourceId) ?? 0, Number(item.receivableSettledAmount ?? item.reimbursementExpected ?? 0)));
    }
    const paidStatementIds = new Set(allStatements.filter((statement) => String(statement.paymentStatus) === "PAID").map((statement) => String(statement.id)));
    totals.grossReceivable = [...grossReceivableBySource.values()].reduce((sum, value) => sum + value, 0);
    totals.collectedReceivable = [...collectedBySource.values()].reduce((sum, value) => sum + value, 0);
    totals.paidStatementReceivable = [...collectedBySource.entries()].reduce((sum, [sourceId, value]) => sum + (paidStatementIds.has(sourceStatementById.get(sourceId) ?? "") ? value : 0), 0);
    totals.outstandingReceivable = [...openReceivableBySource.entries()].reduce((sum, [sourceId, value]) => sum + Math.max(0, value - (collectedBySource.get(sourceId) ?? 0)), 0);
    const netAssets = activeRealMoney + totals.outstandingReceivable - totals.currentCardDebt;
    const creditDebtBalance = totals.currentCardDebt;
    return financialReportSchema.parse({
      range,
      totals,
      netAssets,
      creditDebtBalance,
      debit: byAccountType.get("DEBIT") ?? empty(),
      cash: byAccountType.get("CASH") ?? empty(),
      eWallet: byAccountType.get("E_WALLET") ?? empty(),
      realMoney: ["DEBIT", "CASH", "E_WALLET"].reduce((total, type) => { const value = byAccountType.get(type); if (value) { total.personalSpending += value.personalSpending; total.debitCashflow += value.debitCashflow; total.creditDebt += value.creditDebt; total.outstandingReceivable += value.outstandingReceivable; total.reimbursementReceived += value.reimbursementReceived; total.transactionCount += value.transactionCount; } return total; }, empty()),
      credit: byAccountType.get("CREDIT") ?? empty(),
      creditDebtLedger,
      byCategory: Object.fromEntries(byCategory),
      byAccount: Object.fromEntries([...byAccount.entries()].map(([id, value]) => [id, { name: accountNames.get(id) ?? "", ...value }])),
    }) as FinancialReportDto;
  }

}
