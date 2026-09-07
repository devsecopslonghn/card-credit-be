import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthRepository } from "./auth-repository.js";
import { browserServiceContext } from "./context.js";
import type { MasterdataRepository, MasterRecord } from "./masterdata.js";
import { masterBankListSchema, masterCardTypeListSchema } from "@card-credit/contracts";
import { MasterdataQueryService } from "./services/masterdata-query-service.js";
import { MasterdataCommandService } from "./services/masterdata-command-service.js";
export const registerMasterdataRoutes = (app: FastifyInstance, repository: MasterdataRepository, secret: string, users: Pick<AuthRepository, "findUserById">) => {
  const context = (request: FastifyRequest) => browserServiceContext(request, secret, users);
  app.get<{ Querystring: { limit?: string } }>("/api/banks", async (request) => masterBankListSchema.parse(await MasterdataQueryService.listBanks(await context(request), repository, request.query.limit)));
  app.post<{ Body: MasterRecord }>("/api/banks", async (request, reply) => { const result = await MasterdataCommandService.create(await context(request), "banks", request.body ?? {}, repository); if (result.duplicateMessage) return reply.status(400).send({ message: result.duplicateMessage }); return reply.status(201).send(result.record); });
  app.put<{ Params: { id: string }; Body: MasterRecord }>("/api/banks/:id", async (request) => MasterdataCommandService.update(await context(request), "banks", request.params.id, request.body ?? {}, repository));
  app.delete<{ Params: { id: string } }>("/api/banks/:id", async (request) => { await MasterdataCommandService.remove(await context(request), "banks", request.params.id, repository); return { message: "Đã xóa ngân hàng thành công" }; });
  app.get<{ Querystring: { limit?: string } }>("/api/cardtypes", async (request) => masterCardTypeListSchema.parse(await MasterdataQueryService.listCardTypes(await context(request), repository, request.query.limit)));
  app.post<{ Body: MasterRecord }>("/api/cardtypes", async (request, reply) => { const result = await MasterdataCommandService.create(await context(request), "cardtypes", request.body ?? {}, repository); if (result.duplicateMessage) return reply.status(400).send({ message: result.duplicateMessage }); return reply.status(201).send(result.record); });
  app.put<{ Params: { id: string }; Body: MasterRecord }>("/api/cardtypes/:id", async (request) => MasterdataCommandService.update(await context(request), "cardtypes", request.params.id, request.body ?? {}, repository));
  app.delete<{ Params: { id: string } }>("/api/cardtypes/:id", async (request) => { await MasterdataCommandService.remove(await context(request), "cardtypes", request.params.id, repository); return { message: "Đã xóa loại thẻ thành công" }; });
};
