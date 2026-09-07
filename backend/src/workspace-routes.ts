import type { FastifyInstance } from "fastify";
import type { AuthRepository } from "./auth-repository.js";
import { browserServiceContext } from "./context.js";
import { WorkspaceService } from "./services/workspace-service.js";

export const registerWorkspaceRoutes = (app: FastifyInstance, users: AuthRepository, secret: string) => {
  app.get("/api/workspace/owner", async (request) => ({ data: await WorkspaceService.ownerStatus(await browserServiceContext(request, secret, users)) }));
  app.put<{ Body: { ownerUserId?: unknown } }>("/api/workspace/owner", async (request) => {
    const context = await browserServiceContext(request, secret, users);
    return { data: await WorkspaceService.setOwner(context, request.body?.ownerUserId, users) };
  });
};
