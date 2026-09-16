import type { FastifyInstance } from "fastify";
import { ApiError } from "./errors.js";
import { browserServiceContext } from "./context.js";
import type { AuthRepository } from "./auth-repository.js";
import { CardQueryService } from "./services/card-query-service.js";
import { CardReadFacade } from "./services/card-read-facade.js";
import { CardCommandService } from "./services/card-command-service.js";
import { CardLifecycleService } from "./services/card-lifecycle-service.js";
import { MongoCatalogRepository } from "./mongo-catalog-repository.js";
import type { CatalogRepository } from "./catalog.js";

type Data = Record<string, unknown>;

export const registerCardRoutes = (app: FastifyInstance, secret: string, users?: AuthRepository, catalog: CatalogRepository = new MongoCatalogRepository()) => {
  app.get<{ Querystring: { limit?: string } }>("/api/cards", async (request) => CardReadFacade.listCards(await browserServiceContext(request, secret, users), request.query.limit));
  app.post<{ Body: Data }>("/api/cards", async (request, reply) => reply.code(201).send(await CardCommandService.create(await browserServiceContext(request, secret, users), request.body ?? {}, catalog)));
  app.get<{ Querystring: { limit?: string } }>("/api/cards/duplicates", async (request) => {
    const groups = await CardQueryService.listDuplicates(await browserServiceContext(request, secret, users), request.query.limit);
    return { data: groups };
  });
  app.post<{ Body: Record<string, unknown> }>("/api/cards/duplicates", async (request) => { const context = await browserServiceContext(request, secret, users); const sourceId = request.body?.sourceCardId; const targetId = request.body?.targetCardId; if (typeof sourceId !== "string" || typeof targetId !== "string") throw new ApiError(400, "INVALID_MERGE_TARGET", "Tham chiếu merge không hợp lệ."); const result = await CardLifecycleService.merge(context, sourceId, targetId); return { data: { targetCard: result.targetCard, retiredSourceId: result.retiredSourceId, merge: { sourceCardId: sourceId, targetCardId: targetId, reason: "Same workspace, catalog preset and normalized owner.", historyPolicy: "RESTRICT_REFERENCED_SOURCE" } } }; });
  app.get<{ Params: { id: string } }>("/api/cards/:id", async (request) => CardQueryService.get(await browserServiceContext(request, secret, users), request.params.id));
  app.put<{ Params: { id: string }; Body: Data }>("/api/cards/:id", async (request) => {
    return CardCommandService.update(await browserServiceContext(request, secret, users), request.params.id, request.body ?? {});
  });
  app.delete<{ Params: { id: string } }>("/api/cards/:id", async (request) => { const context = await browserServiceContext(request, secret, users); const result = await CardLifecycleService.retire(context, request.params.id); return { message: "Đã đưa thẻ vào trạng thái đã lưu trữ", data: result }; });
};
