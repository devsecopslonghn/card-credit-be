import type { CardDto, StatementDto } from "@card-credit/contracts";
import { CardQueryService } from "./card-query-service.js";
import { StatementQueryService } from "./statement-query-service.js";
import type { ServiceContext } from "./types/service-context.js";

type NotificationStatement = Pick<StatementDto, "id" | "effectivePaymentStatus" | "paymentDueDate" | "paymentStatus" | "cardId">;
type NotificationCard = Pick<CardDto, "id" | "providerName" | "displayName">;
export type NotificationDependencies = {
  listStatements: (context: ServiceContext, limit: number) => Promise<NotificationStatement[]>;
  listCards: (context: ServiceContext) => Promise<NotificationCard[]>;
};

const defaults: NotificationDependencies = {
  listStatements: (context, limit) => StatementQueryService.listNotifications(context, limit),
  listCards: (context) => CardQueryService.list(context),
};

const boundedLimit = (value: unknown) => Math.min(Math.max(Number.parseInt(typeof value === "string" ? value : "50", 10) || 50, 1), 100);

export class NotificationService {
  static async list(context: ServiceContext, rawLimit: unknown, dependencies: NotificationDependencies = defaults) {
    const limit = boundedLimit(rawLimit);
    const [statements, cards] = await Promise.all([
      dependencies.listStatements(context, limit),
      dependencies.listCards(context),
    ]);
    const cardById = new Map(cards.map((card) => [card.id, card]));
    return {
      data: statements.map((statement) => {
        const card = cardById.get(statement.cardId);
        const status = statement.effectivePaymentStatus === "PAID" ? "success" : statement.effectivePaymentStatus === "OVERDUE" ? "alert" : "warning";
        const providerName = card?.providerName ?? "Thẻ tín dụng";
        const displayName = card?.displayName ?? "";
        return {
          id: statement.id,
          type: "payment_due" as const,
          status,
          title: status === "success" ? "Đã ghi nhận thanh toán" : "Kỳ thanh toán cần theo dõi",
          message: `${providerName}${displayName ? ` · ${displayName}` : ""}`.trim(),
          dueDate: statement.paymentDueDate,
          paymentStatus: statement.paymentStatus,
          cardId: statement.cardId,
        };
      }),
      meta: { limit, source: "card_statements" as const },
    };
  }
}
