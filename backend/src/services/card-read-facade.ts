import type { CardDto } from "@card-credit/contracts";
import { CardQueryService } from "./card-query-service.js";
import { CashFlowQueryService } from "./cash-flow-query-service.js";
import { StatementQueryService } from "./statement-query-service.js";
import type { ServiceContext } from "./types/service-context.js";

/**
 * Canonical read boundary shared by REST, MCP and reporting adapters.
 * Adapters must not join CreditCard/CardStatement/FinancialTransaction directly.
 */
export class CardReadFacade {
  static listCards(ctx: ServiceContext, limit?: unknown): Promise<CardDto[]> {
    return CardQueryService.list(ctx, { activeOnly: true }, limit);
  }

  static findCards(ctx: ServiceContext, options: { query?: string; owner?: string; limit?: unknown } = {}): Promise<CardDto[]> {
    return CardQueryService.search(ctx, options);
  }

  static getCard(ctx: ServiceContext, cardId: string): Promise<CardDto> {
    return CardQueryService.get(ctx, cardId);
  }

  static listStatements(ctx: ServiceContext, options: Parameters<typeof StatementQueryService.listPage>[1] = {}) {
    return StatementQueryService.listPage(ctx, options);
  }

  static monthlyCashFlow(ctx: ServiceContext, options: { period?: string; cardId?: string } = {}) {
    return CashFlowQueryService.list(ctx, options);
  }
}
