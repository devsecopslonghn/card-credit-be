import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import type { AuthRepository } from "./auth-repository.js";
import { NotificationService } from "./services/notification-service.js";

/** Read-only notification projection for the Stitch notifications screen. */
export const registerNotificationRoutes = (app: FastifyInstance, secret: string, users?: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { limit?: string } }>("/api/notifications", async (request) => NotificationService.list(await browserServiceContext(request, secret, users), request.query.limit));
};
