import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import { RecurringExpenseService } from "./services/recurring-expense-service.js";
import type { AuthRepository } from "./auth-repository.js";
export const registerRecurringExpenseRoutes = (app: FastifyInstance, secret: string, users?: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { limit?: string } }>("/api/finance/recurring-expenses", async (request) => ({ data: await RecurringExpenseService.list(await browserServiceContext(request, secret, users), Number(request.query.limit)) }));
  app.post("/api/finance/recurring-expenses", async (request, reply) => reply.code(201).send({ data: await RecurringExpenseService.create(await browserServiceContext(request, secret, users), request.body) }));
  app.put<{ Params: { id: string } }>("/api/finance/recurring-expenses/:id", async (request) => ({ data: await RecurringExpenseService.update(await browserServiceContext(request, secret, users), request.params.id, request.body) }));
  app.delete<{ Params: { id: string } }>("/api/finance/recurring-expenses/:id", async (request) => ({ data: await RecurringExpenseService.deactivate(await browserServiceContext(request, secret, users), request.params.id) }));
};
