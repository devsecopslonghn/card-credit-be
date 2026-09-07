import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import { FeeQueryService } from "./services/fee-query-service.js";
import { FeeCommandService, parseFeeCenterCategory } from "./services/fee-command-service.js";
import type { AuthRepository } from "./auth-repository.js";

type Data = Record<string, unknown>;
const serialized = (value: unknown) => JSON.parse(JSON.stringify(value)) as Data;

export const registerFeeCenterRoutes = (app: FastifyInstance, secret: string, users: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { cardId?: string; category?: string; limit?: string } }>("/api/fee-center", async (request) => {
    const context = await browserServiceContext(request, secret, users);
    const options = {
      ...(request.query.cardId ? { cardId: request.query.cardId } : {}),
      ...(request.query.category ? { category: parseFeeCenterCategory(request.query.category) } : {}),
    };
    return { data: await FeeQueryService.listCenter(context, options, request.query.limit) };
  });
  app.post<{ Body: Data }>("/api/fee-center", async (request, reply) => {
    const record = await FeeCommandService.createCenter(await browserServiceContext(request, secret, users), request.body ?? {});
    return reply.code(201).send({ data: serialized(record) });
  });
  app.put<{ Params: { id: string }; Body: Data }>("/api/fee-center/:id", async (request) => ({ data: serialized(await FeeCommandService.updateCenter(await browserServiceContext(request, secret, users), request.params.id, request.body ?? {})) }));
  app.delete<{ Params: { id: string } }>("/api/fee-center/:id", async (request) => ({ data: await FeeCommandService.deleteCenter(await browserServiceContext(request, secret, users), request.params.id) }));
};
