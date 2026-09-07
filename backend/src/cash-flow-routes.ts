import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import type { AuthRepository } from "./auth-repository.js";
import { CashFlowQueryService } from "./services/cash-flow-query-service.js";

/** Compatibility endpoint: reads only the Financial Domain, never legacy card transactions. */
export const registerCashFlowRoutes = (app: FastifyInstance, secret: string, users: Pick<AuthRepository, "findUserById">) => app.get<{ Querystring: { period?: string; cardId?: string } }>("/api/cash-flow/monthly", async (request, reply) => {
  const result = await CashFlowQueryService.list(await browserServiceContext(request, secret, users), { period: request.query.period, cardId: request.query.cardId });
  const data = result.data.map((row) => ({
    ...row,
    card: row.card ? { ...row.card, bank: row.card.providerName ?? undefined, name: row.card.displayName ?? undefined } : null,
  }));
  return reply.send({ data, period: result.period });
});
