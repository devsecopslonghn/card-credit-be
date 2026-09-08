import mongoose from "mongoose";
import { financialTransactionSchema, statementListSchema, statementSchema } from "@card-credit/contracts";
import type { FinancialTransactionDto, StatementDto } from "@card-credit/contracts";
import { CardStatementModel } from "../models/card-statement.js";
import { CreditCardModel } from "../models/credit-card.js";
import { FinancialTransactionModel } from "../models/financial-transaction.js";
import { ApiError } from "../errors.js";
import { boundedReadLimit, READ_MAX_LIMIT } from "../read-limits.js";
import { effectivePaymentStatus, idOf, plain, type Data } from "../statement-domain.js";
import type { ServiceContext } from "./types/service-context.js";

type StatementReadOptions = { cardId?: string; cardIds?: string[]; unpaidOnly?: boolean; paymentDueDates?: string[]; statementDateFrom?: string; statementDateTo?: string; limit?: number; cursor?: string; order?: "statementDate" | "paymentDueDate" };
export type StatementReadRepository = {
  listStatements(workspaceId: string, options: StatementReadOptions): Promise<Data[]>;
  findStatementById(workspaceId: string, statementId: string): Promise<Data | null>;
  findStatement(workspaceId: string, cardId: string, statementId: string): Promise<Data | null>;
  findCard(workspaceId: string, cardId: string): Promise<Data | null>;
  listCards(workspaceId: string, cardIds: string[]): Promise<Data[]>;
  listTransactions(workspaceId: string, statementIds: string[]): Promise<Data[]>;
};

const execute = async <T>(query: unknown): Promise<T> => {
  const value = query as { lean?: () => unknown };
  return (typeof value?.lean === "function" ? await value.lean() : await query) as T;
};

const sorted = (query: unknown, sort: Record<string, 1 | -1>) => {
  const value = query as { sort?: (spec: Record<string, 1 | -1>) => unknown };
  return typeof value?.sort === "function" ? value.sort(sort) : query;
};

type StatementCursor = { field: "statementDate" | "paymentDueDate"; value: string; id: string };

const encodeCursor = (statement: Data, field: StatementCursor["field"]) => Buffer.from(JSON.stringify({ field, value: String(statement[field] ?? ""), id: idOf(statement._id) } satisfies StatementCursor)).toString("base64url");

const decodeCursor = (value: string | undefined, field: StatementCursor["field"]): StatementCursor | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<StatementCursor>;
    if (parsed.field !== field || typeof parsed.value !== "string" || !parsed.value || typeof parsed.id !== "string" || !parsed.id) throw new Error("invalid cursor");
    return parsed as StatementCursor;
  } catch {
    throw new ApiError(400, "INVALID_STATEMENT_CURSOR", "Cursor sao kê không hợp lệ.");
  }
};

const mongoRepository: StatementReadRepository = {
  async listStatements(workspaceId, options) {
    const query: Record<string, unknown> = { workspaceId };
    if (options.cardId) query.userCardId = options.cardId;
    else if (options.cardIds?.length) query.userCardId = { $in: options.cardIds };
    if (options.unpaidOnly) query.paymentStatus = { $ne: "PAID" };
    if (options.paymentDueDates?.length) query.paymentDueDate = { $in: options.paymentDueDates };
    if (options.statementDateFrom || options.statementDateTo) query.statementDate = { ...(options.statementDateFrom ? { $gte: options.statementDateFrom } : {}), ...(options.statementDateTo ? { $lte: options.statementDateTo } : {}) };
    const field = options.order === "paymentDueDate" ? "paymentDueDate" : "statementDate";
    const direction = field === "paymentDueDate" ? 1 : -1;
    const cursorValue = decodeCursor(options.cursor, field);
    if (cursorValue) query.$or = [
      { [field]: { [direction === 1 ? "$gt" : "$lt"]: cursorValue.value } },
      { [field]: cursorValue.value, _id: { [direction === 1 ? "$gt" : "$lt"]: cursorValue.id } },
    ];
    let cursor = sorted(CardStatementModel.find(query), { [field]: direction, _id: direction }) as { limit?: (value: number) => unknown };
    if (options.limit && typeof cursor?.limit === "function") cursor = cursor.limit(Math.min(Math.max(options.limit, 1), READ_MAX_LIMIT + 1)) as typeof cursor;
    return execute<Data[]>(cursor);
  },
  async findStatement(workspaceId, cardId, statementId) {
    return execute<Data | null>(CardStatementModel.findOne({ _id: statementId, userCardId: cardId, workspaceId }));
  },
  async findStatementById(workspaceId, statementId) {
    return execute<Data | null>(CardStatementModel.findOne({ _id: statementId, workspaceId }));
  },
  async findCard(workspaceId, cardId) {
    return execute<Data | null>(CreditCardModel.findOne({ _id: cardId, workspaceId }));
  },
  async listCards(workspaceId, cardIds) {
    if (!cardIds.length) return [];
    return execute<Data[]>(sorted(CreditCardModel.find({ _id: { $in: cardIds }, workspaceId }), { createdAt: -1 }));
  },
  async listTransactions(workspaceId, statementIds) {
    if (!statementIds.length) return [];
    return execute<Data[]>(sorted(FinancialTransactionModel.find({ statementId: { $in: statementIds }, workspaceId }), { transactionDate: -1, createdAt: -1 }));
  },
};

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const summarizeStatementTransactions = (transactions: Data[]) => {
  let statementAmount = 0;
  let paymentAmount = 0;
  let personalSpending = 0;
  let outstandingReceivable = 0;
  let reimbursementReceived = 0;
  let transactionCount = 0;
  for (const transaction of transactions) {
    const type = String(transaction.transactionType ?? "");
    const creditDebt = numberValue(transaction.creditDebt);
    const amount = numberValue(transaction.amount);
    if (type === "STATEMENT_PAYMENT" || creditDebt < 0) paymentAmount += Math.max(-creditDebt, type === "STATEMENT_PAYMENT" ? amount : 0);
    else statementAmount += Math.max(creditDebt, 0);
    if (type !== "STATEMENT_PAYMENT") {
      transactionCount += 1;
      personalSpending += Math.max(numberValue(transaction.personalSpending), 0);
      outstandingReceivable += Math.max(numberValue(transaction.outstandingReceivable), 0);
    }
    if (type === "REIMBURSEMENT") reimbursementReceived += Math.max(numberValue(transaction.reimbursementReceived) || amount, 0);
  }
  return {
    statementAmount,
    paymentAmount,
    outstandingAmount: Math.max(statementAmount - paymentAmount, 0),
    personalSpending,
    outstandingReceivable: Math.max(outstandingReceivable - reimbursementReceived, 0),
    reimbursementReceived,
    transactionCount,
  };
};

const transactionDto = (value: Data): FinancialTransactionDto => ({
  id: idOf(value._id),
  accountId: idOf(value.accountId),
  statementId: value.statementId ? idOf(value.statementId) : null,
  reimbursementForTransactionId: value.reimbursementForTransactionId ? idOf(value.reimbursementForTransactionId) : null,
  accountType: String(value.accountType) as FinancialTransactionDto["accountType"],
  transactionType: String(value.transactionType) as FinancialTransactionDto["transactionType"],
  ownership: String(value.ownership ?? "PERSONAL") as FinancialTransactionDto["ownership"],
  amount: numberValue(value.amount),
  serviceFeeRate: typeof value.serviceFeeRate === "number" ? value.serviceFeeRate : null,
  categoryId: String(value.categoryId ?? "OTHER"),
  transactionDate: String(value.transactionDate),
  note: String(value.note ?? ""),
  impact: {
    personalSpending: numberValue(value.personalSpending),
    debitCashflow: numberValue(value.debitCashflow),
    creditDebt: numberValue(value.creditDebt),
    outstandingReceivable: numberValue(value.outstandingReceivable),
    reimbursementReceived: numberValue(value.reimbursementReceived),
  },
});

const dateString = (value: unknown, fallback: string) => value ? String(value) : fallback;

export const serializeStatementDto = (statement: Data, transactions: Data[] = [], includeTransactions = false): StatementDto => {
  const value = plain(statement);
  const statementDate = dateString(value.statementDate, dateString(value.periodEndDate, "1970-01-01"));
  const periodStartDate = dateString(value.periodStartDate, statementDate);
  const periodEndDate = dateString(value.periodEndDate, statementDate);
  const paymentDueDate = dateString(value.paymentDueDate, statementDate);
  const summary = summarizeStatementTransactions(transactions ?? []);
  return statementSchema.parse({
    id: idOf(value._id),
    cardId: idOf(value.userCardId),
    periodStartDate,
    periodEndDate,
    statementDate,
    paymentDueDate,
    statementDaySnapshot: Number(value.statementDaySnapshot ?? (Number(statementDate.slice(-2)) || 1)),
    paymentDueDaysSnapshot: Number(value.paymentDueDaysSnapshot ?? 1),
    paymentStatus: String(value.paymentStatus ?? "OPEN"),
    effectivePaymentStatus: effectivePaymentStatus(value),
    paidAt: value.paidAt ? String(value.paidAt) : null,
    paidAmount: value.paidAmount === null || value.paidAmount === undefined ? null : numberValue(value.paidAmount),
    summary,
    ...(includeTransactions ? { transactions: transactions.map((transaction) => financialTransactionSchema.parse(transactionDto(transaction))) } : {}),
  }) as StatementDto;
};

export class StatementQueryServiceImpl {
  constructor(private readonly repository: StatementReadRepository = mongoRepository) {}

  async list(ctx: ServiceContext, options: { cardId?: string; unpaidOnly?: boolean; statementDateFrom?: string; statementDateTo?: string; limit?: number; order?: "statementDate" | "paymentDueDate"; includeTransactions?: boolean } = {}) {
    if (options.cardId) await this.requireCard(ctx, options.cardId);
    const loaded = await this.repository.listStatements(ctx.workspaceId, { cardId: options.cardId, unpaidOnly: options.unpaidOnly, statementDateFrom: options.statementDateFrom, statementDateTo: options.statementDateTo, limit: options.limit, order: options.order ?? "statementDate" });
    const statements = options.cardId ? loaded : await this.onlyExistingCards(ctx, loaded);
    return this.build(statements, ctx.workspaceId, options.includeTransactions !== false);
  }

  async listPage(ctx: ServiceContext, options: { cardId?: string; unpaidOnly?: boolean; statementDateFrom?: string; statementDateTo?: string; limit?: number; cursor?: string; order?: "statementDate" | "paymentDueDate"; includeTransactions?: boolean } = {}) {
    if (options.cardId) await this.requireCard(ctx, options.cardId);
    const limit = boundedReadLimit(options.limit);
    const loaded = await this.repository.listStatements(ctx.workspaceId, {
      cardId: options.cardId,
      unpaidOnly: options.unpaidOnly,
      statementDateFrom: options.statementDateFrom,
      statementDateTo: options.statementDateTo,
      limit: limit + 1,
      cursor: options.cursor,
      order: options.order ?? "statementDate",
    });
    const hasMore = loaded.length > limit;
    const page = loaded.slice(0, limit);
    const statements = options.cardId ? page : await this.onlyExistingCards(ctx, page);
    return {
      data: await this.build(statements, ctx.workspaceId, options.includeTransactions !== false),
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!, options.order === "paymentDueDate" ? "paymentDueDate" : "statementDate") : null,
      limit,
    };
  }

  async get(ctx: ServiceContext, cardId: string, statementId: string) {
    await this.requireCard(ctx, cardId);
    if (!mongoose.isValidObjectId(statementId)) throw new ApiError(400, "INVALID_STATEMENT_ID", "Statement id không hợp lệ.");
    const statement = await this.repository.findStatement(ctx.workspaceId, cardId, statementId);
    if (!statement) throw new ApiError(404, "STATEMENT_NOT_FOUND", "Không tìm thấy sao kê.");
    const [result] = await this.build([statement], ctx.workspaceId, true);
    return result!;
  }

  async getById(ctx: ServiceContext, statementId: string) {
    if (!mongoose.isValidObjectId(statementId)) return null;
    const statement = await this.repository.findStatementById(ctx.workspaceId, statementId);
    if (!statement) return null;
    const cardId = idOf(statement.userCardId);
    if (!mongoose.isValidObjectId(cardId) || !(await this.repository.findCard(ctx.workspaceId, cardId))) return null;
    const [result] = await this.build([statement], ctx.workspaceId, true);
    return result ?? null;
  }

  async upcoming(ctx: ServiceContext, limit = 20) {
    const loaded = await this.repository.listStatements(ctx.workspaceId, { unpaidOnly: true, limit, order: "paymentDueDate" });
    const statements = await this.onlyExistingCards(ctx, loaded);
    return this.build(statements, ctx.workspaceId, false);
  }

  async listNotifications(ctx: ServiceContext, limit = 50) {
    const boundedLimit = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 100);
    const statements = await this.repository.listStatements(ctx.workspaceId, { unpaidOnly: false, limit: boundedLimit, order: "paymentDueDate" });
    // Notifications intentionally retain orphan statements for compatibility;
    // the adapter supplies the existing card-name fallback when no card exists.
    return this.build(statements, ctx.workspaceId, false);
  }

  async listForCardIds(ctx: ServiceContext, cardIds: string[], options: { unpaidOnly?: boolean; paymentDueDates?: string[]; order?: "statementDate" | "paymentDueDate" } = {}) {
    if (!cardIds.length) return [];
    const ownedCards = await this.repository.listCards(ctx.workspaceId, [...new Set(cardIds)]);
    const ownedCardIds = [...new Set(ownedCards.map((card) => idOf(card._id)))];
    if (!ownedCardIds.length) return [];
    const statements = await this.repository.listStatements(ctx.workspaceId, { cardIds: ownedCardIds, unpaidOnly: options.unpaidOnly, ...(options.paymentDueDates ? { paymentDueDates: options.paymentDueDates } : {}), order: options.order ?? "statementDate" });
    return this.build(statements, ctx.workspaceId, false);
  }

  private async onlyExistingCards(ctx: ServiceContext, statements: Data[]) {
    const cardIds = [...new Set(statements.map((statement) => idOf(statement.userCardId)))];
    if (!cardIds.length) return [];
    const cards = await this.repository.listCards(ctx.workspaceId, cardIds);
    const existing = new Set(cards.map((card) => idOf(card._id)));
    return statements.filter((statement) => existing.has(idOf(statement.userCardId)));
  }

  private async requireCard(ctx: ServiceContext, cardId: string) {
    if (!mongoose.isValidObjectId(cardId)) throw new ApiError(400, "INVALID_CARD_ID", "Card id không hợp lệ.");
    const card = await this.repository.findCard(ctx.workspaceId, cardId);
    if (!card) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    return card;
  }

  private async build(statements: Data[], workspaceId: string, includeTransactions: boolean) {
    const statementIds = statements.map((statement) => idOf(statement._id));
    const [transactions] = await Promise.all([this.repository.listTransactions(workspaceId, statementIds)]);
    const grouped = new Map<string, Data[]>();
    for (const transaction of transactions) {
      const id = idOf(transaction.statementId);
      grouped.set(id, [...(grouped.get(id) ?? []), transaction]);
    }
    return statementListSchema.parse(statements.map((statement) => serializeStatementDto(statement, grouped.get(idOf(statement._id)) ?? [], includeTransactions))) as StatementDto[];
  }
}

export const StatementQueryService = new StatementQueryServiceImpl();
export const createStatementQueryService = (repository: StatementReadRepository) => new StatementQueryServiceImpl(repository);
