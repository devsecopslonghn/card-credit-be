import mongoose from "mongoose";
import { monthlyCashFlowResponseSchema, type MonthlyCashFlowResponseDto, type MonthlyCashFlowRowDto } from "@card-credit/contracts";
import { ApiError } from "../errors.js";
import { AccountModel } from "../models/account.js";
import { CardStatementModel } from "../models/card-statement.js";
import { CreditCardModel } from "../models/credit-card.js";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { CardFeePaymentModel } from "../models/card-fee-payment.js";
import { MonthlyCardCashbackModel } from "../models/monthly-card-cashback.js";
import type { ServiceContext } from "./types/service-context.js";

const periodPattern = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
const validPeriod = (value: unknown): value is string => typeof value === "string" && periodPattern.test(value);
const currentPeriod = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthRange = (value: string) => {
  const [year = 0, month = 1] = value.split("-").map(Number);
  return { start: `${value}-01`, next: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10) };
};
const idOf = (value: unknown) => String(value ?? "");
const amount = (value: unknown) => Number(value ?? 0);

export class CashFlowQueryService {
  static async list(ctx: ServiceContext, options: { period?: string; cardId?: string } = {}): Promise<MonthlyCashFlowResponseDto> {
    const selectedPeriod = options.period ?? currentPeriod();
    if (!validPeriod(selectedPeriod)) throw new ApiError(400, "INVALID_PERIOD", "Kỳ tháng không hợp lệ.");
    if (options.cardId && !mongoose.isValidObjectId(options.cardId)) throw new ApiError(400, "INVALID_CARD_ID", "Card id không hợp lệ.");
    const range = monthRange(selectedPeriod);
    const cards = await CreditCardModel.find({ workspaceId: ctx.workspaceId, ...(options.cardId ? { _id: options.cardId } : {}) }).sort({ providerName: 1, displayName: 1 }).lean();
    const cardIds = cards.map((card) => card._id);
    const [accounts, statements, transactions, feePayments, monthlyCashbacks] = await Promise.all([
      AccountModel.find({ workspaceId: ctx.workspaceId, type: "CREDIT", creditCardId: { $in: cardIds } }).lean(),
      CardStatementModel.find({ workspaceId: ctx.workspaceId, userCardId: { $in: cardIds } }).select({ _id: 1, userCardId: 1 }).lean(),
      FinancialTransactionModel.find({ workspaceId: ctx.workspaceId, transactionDate: { $gte: range.start, $lt: range.next } }).lean(),
      CardFeePaymentModel.find({ workspaceId: ctx.workspaceId, userCardId: { $in: cardIds }, paymentDate: { $gte: range.start, $lt: range.next } }).lean(),
      MonthlyCardCashbackModel.find({ workspaceId: ctx.workspaceId, userCardId: { $in: cardIds }, period: selectedPeriod }).lean(),
    ]);
    const accountToCard = new Map(accounts.map((account) => [idOf(account._id), idOf(account.creditCardId)]));
    const statementToCard = new Map(statements.map((statement) => [idOf(statement._id), idOf(statement.userCardId)]));
    const data: MonthlyCashFlowRowDto[] = cards.map((card) => {
      const cardId = idOf(card._id);
      const own = transactions.filter((item) =>
        (accountToCard.has(idOf(item.accountId)) && accountToCard.get(idOf(item.accountId)) === cardId)
        || (item.transactionType === "STATEMENT_PAYMENT" && item.statementId && statementToCard.get(idOf(item.statementId)) === cardId));
      const statementPayments = own.filter((item) => item.transactionType === "STATEMENT_PAYMENT").reduce((sum, item) => sum + amount(item.amount), 0);
      const partnerReturns = own.filter((item) => item.transactionType === "REIMBURSEMENT" || item.transactionType === "REFUND").reduce((sum, item) => sum + amount(item.amount), 0);
      const cardFees = feePayments.filter((item) => idOf(item.userCardId) === cardId);
      const actualFees = cardFees.filter((item) => ["ANNUAL_CARD_FEE", "MANAGEMENT_FEE", "OTHER_FEE"].includes(String(item.category))).reduce((sum, item) => sum + amount(item.amount), 0);
      const feePartnerReturns = cardFees.filter((item) => item.category === "PARTNER_REFUND").reduce((sum, item) => sum + amount(item.amount), 0);
      const bankCashbackActual = monthlyCashbacks.filter((item) => idOf(item.userCardId) === cardId && item.status === "RECEIVED").reduce((sum, item) => sum + amount(item.actualAmount), 0);
      const totalIn = partnerReturns + feePartnerReturns + bankCashbackActual;
      const totalOut = statementPayments + actualFees;
      const row: MonthlyCashFlowRowDto = {
        cardId,
        period: selectedPeriod,
        totalOut,
        totalIn,
        statementPayments,
        actualFees,
        partnerReturns: partnerReturns + feePartnerReturns,
        bankCashbackActual,
        netResult: totalIn - totalOut,
        card: { id: cardId, providerName: typeof card.providerName === "string" ? card.providerName : null, displayName: typeof card.displayName === "string" ? card.displayName : null, owner: typeof card.owner === "string" ? card.owner : null },
      };
      return row;
    });
    return monthlyCashFlowResponseSchema.parse({ data, period: selectedPeriod }) as MonthlyCashFlowResponseDto;
  }
}
