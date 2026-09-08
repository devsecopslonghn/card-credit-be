import mongoose from "mongoose";
import { ApiError } from "../errors.js";
import { CreditCardModel } from "../models/credit-card.js";
import { normalizeReminderPreferences } from "../reminder-preferences.js";
import type { CatalogProduct, CatalogRepository } from "../catalog.js";
import type { ServiceContext } from "./types/service-context.js";
import { cardDtoFromDocument } from "./card-query-service.js";
import type { CardDto } from "@card-credit/contracts";

type Data = Record<string, unknown>;
export type CardWriteRepository = {
  create(input: Data): Promise<unknown>;
  findOne(filter: Data): Promise<unknown | null>;
  findOneAndUpdate(filter: Data, update: Data): Promise<unknown | null>;
};

const cardRepository: CardWriteRepository = {
  create: (input) => CreditCardModel.create(input),
  findOne: (filter) => CreditCardModel.findOne(filter).lean().exec(),
  findOneAndUpdate: (filter, update) => CreditCardModel.findOneAndUpdate(filter, update, { returnDocument: "after" }).lean().exec(),
};

const months = () => Array.from({ length: 12 }, (_, index) => ({ month: index + 1, spend: 0, cashback: 0, fee: 0, otherInterest: 0 }));
const owner = (value: unknown) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new ApiError(400, "INVALID_OWNER", "Tên chủ thẻ không hợp lệ.", { owner: "Tên chủ thẻ là bắt buộc và tối đa 120 ký tự." });
  return value.trim().replace(/\s+/g, " ");
};
const optionalNumber = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ.", { [field]: `${field} phải là số.` });
  return value;
};
const validId = (id: string) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, "INVALID_CARD_ID", "Card id không hợp lệ.");
};
const productById = (products: CatalogProduct[], presetId: string) => {
  const product = products.find((candidate) => candidate.presetId === presetId);
  if (!product) throw new ApiError(404, "PRESET_NOT_FOUND", "Không tìm thấy Card Product.");
  if (!product.active) throw new ApiError(409, "PRESET_INACTIVE", "Card Product hiện không còn hoạt động.");
  return product;
};

const createFromCatalog = (ctx: ServiceContext, body: Data, product: CatalogProduct) => ({
  userId: ctx.userId,
  workspaceId: ctx.workspaceId,
  presetId: product.presetId,
  providerCode: product.providerCode,
  providerName: product.providerName,
  displayName: product.displayName,
  network: product.network,
  catalogVersion: "mongodb-v1",
  legacy: false,
  bank: product.providerCode,
  name: product.displayName,
  type: product.network,
  owner: owner(body.owner),
  imageUrl: product.imageUrl ?? "/card-images/placeholder-card.svg",
  annualFee: product.annualFee,
  targetSpendForWaiver: product.targetSpendForWaiver ?? 0,
  annualFeeWaiverTarget: product.targetSpendForWaiver ?? null,
  monthlyData: months(),
});

const createLegacy = (ctx: ServiceContext, body: Data) => {
  if (typeof body.bank !== "string" || typeof body.name !== "string" || typeof body.type !== "string" || typeof body.imageUrl !== "string") throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ.", { presetId: "presetId là bắt buộc cho catalog-first contract." });
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    bank: body.bank,
    name: body.name,
    type: body.type,
    owner: owner(body.owner),
    imageUrl: body.imageUrl,
    annualFee: optionalNumber(body.annualFee, "annualFee"),
    targetSpendForWaiver: typeof body.targetSpendForWaiver === "number" ? body.targetSpendForWaiver : 0,
    legacy: true,
    monthlyData: Array.isArray(body.monthlyData) ? body.monthlyData : months(),
  };
};

const updatePayload = (body: Data): Data => {
  const update: Data = {};
  if ("owner" in body) update.owner = owner(body.owner);
  if ("targetSpendForWaiver" in body) update.targetSpendForWaiver = optionalNumber(body.targetSpendForWaiver, "targetSpendForWaiver");
  if ("annualFeeWaiverTarget" in body) update.annualFeeWaiverTarget = optionalNumber(body.annualFeeWaiverTarget, "annualFeeWaiverTarget");
  if ("statementDay" in body) { const value = optionalNumber(body.statementDay, "statementDay"); if (!Number.isInteger(value) || value < 1 || value > 31) throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ."); update.statementDay = value; }
  if ("paymentDueDays" in body) { const value = optionalNumber(body.paymentDueDays, "paymentDueDays"); if (!Number.isInteger(value) || value < 1) throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ."); update.paymentDueDays = value; }
  if ("cashbackCapAmount" in body) update.cashbackCapAmount = body.cashbackCapAmount === null ? null : optionalNumber(body.cashbackCapAmount, "cashbackCapAmount");
  if ("cashbackCapPeriod" in body) { if (body.cashbackCapPeriod !== "STATEMENT" && body.cashbackCapPeriod !== "CALENDAR_MONTH") throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ."); update.cashbackCapPeriod = body.cashbackCapPeriod; }
  if ("active" in body) { if (typeof body.active !== "boolean") throw new ApiError(400, "INVALID_REQUEST", "Request body không hợp lệ."); update.active = body.active; }
  Object.assign(update, normalizeReminderPreferences(body));
  if (!Object.keys(update).length) throw new ApiError(400, "FORBIDDEN_UPDATE_FIELD", "Không có field hợp lệ để cập nhật.");
  return update;
};

export class CardCommandService {
  static async create(ctx: ServiceContext, body: Data, catalog: CatalogRepository, cards: CardWriteRepository = cardRepository): Promise<CardDto> {
    const input = typeof body.presetId === "string"
      ? createFromCatalog(ctx, body, productById(await catalog.listAllProducts(), body.presetId))
      : createLegacy(ctx, body);
    return cardDtoFromDocument(await cards.create(input));
  }

  static async update(ctx: ServiceContext, cardId: string, body: Data, cards: CardWriteRepository = cardRepository): Promise<CardDto> {
    validId(cardId);
    if (!await cards.findOne({ _id: cardId, workspaceId: ctx.workspaceId })) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    const updated = await cards.findOneAndUpdate({ _id: cardId, workspaceId: ctx.workspaceId }, { $set: updatePayload(body) });
    if (!updated) throw new ApiError(404, "CARD_NOT_FOUND", "Không tìm thấy thẻ.");
    return cardDtoFromDocument(updated);
  }
}

export { owner as normalizeCardOwner, updatePayload as normalizeCardUpdate };
