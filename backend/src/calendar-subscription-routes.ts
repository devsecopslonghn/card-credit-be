import type { FastifyInstance } from "fastify";
import type { AuthRepository } from "./auth-repository.js";
import { browserServiceContext } from "./context.js";
import { CalendarSubscriptionService } from "./services/calendar-subscription-service.js";
import { calendarSubscriptionCreateSchema, calendarSubscriptionListSchema } from "@card-credit/contracts";

export const registerCalendarSubscriptionRoutes = (app: FastifyInstance, users: AuthRepository, secret: string) => {
  app.get<{ Querystring: { limit?: string } }>("/api/calendar-subscriptions", async (request) => ({ data: calendarSubscriptionListSchema.parse(await CalendarSubscriptionService.list(await browserServiceContext(request, secret, users), request.query.limit)) }));
  app.post<{ Body: { deviceLabel?: unknown } }>("/api/calendar-subscriptions", async (request, reply) => {
    const context = await browserServiceContext(request, secret, users);
    return reply.code(201).send({ data: calendarSubscriptionCreateSchema.parse(await CalendarSubscriptionService.create(context, request.body?.deviceLabel)) });
  });
  app.delete<{ Params: { id: string } }>("/api/calendar-subscriptions/:id", async (request) => {
    return { data: await CalendarSubscriptionService.revoke(await browserServiceContext(request, secret, users), request.params.id) };
  });
  app.get<{ Params: { token: string } }>("/api/calendar-subscriptions/feed/:token.ics", { logLevel: "silent" }, async (request, reply) => {
    const context = await CalendarSubscriptionService.feedContext(request.params.token, users, request.id);
    if (!context) return reply.code(404).send("Not found");
    return reply.header("Content-Type", "text/calendar; charset=utf-8").header("Cache-Control", "private, no-store").header("Content-Disposition", 'inline; filename="card-credit-payment-due.ics"').send(await CalendarSubscriptionService.feed(context));
  });
};
