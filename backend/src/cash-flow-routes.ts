import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import type { AuthRepository } from "./auth-repository.js";
import { CashFlowQueryService } from "./services/cash-flow-query-service.js";

/** Reads cash flow from the Financial Domain. */
export const registerCashFlowRoutes = (app: FastifyInstance, secret: string, users: Pick<AuthRepository, "findUserById">) => app.get<{ Querystring: { period?: string; cardId?: string } }>("/api/cash-flow/monthly", async (request, reply) => {
  const result = await CashFlowQueryService.list(await browserServiceContext(request, secret, users), { period: request.query.period, cardId: request.query.cardId });
  return reply.send(result);
});
