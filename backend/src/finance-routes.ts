import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import { FinanceCategoryService } from "./services/finance-category-service.js";
import { FinanceBudgetService } from "./services/finance-budget-service.js";
import type { AuthRepository } from "./auth-repository.js";
import { financeCategoryInputSchema } from "@card-credit/contracts";
import { ApiError } from "./errors.js";

export const registerFinanceRoutes = (app: FastifyInstance, secret: string, users?: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { limit?: string } }>("/api/finance/categories", async (request) => ({ data: await FinanceCategoryService.list(await browserServiceContext(request, secret, users), request.query.limit) }));
  app.post("/api/finance/categories", async (request, reply) => {
    const parsed = financeCategoryInputSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "INVALID_CATEGORY", "Category không hợp lệ.");
    const input = parsed.data as { name: string; parentId?: string };
    return reply.code(201).send({ data: await FinanceCategoryService.create(await browserServiceContext(request, secret, users), input) });
  });
  app.put<{ Body: { month: string; categoryId: string; limitAmount: number; warningPercent?: number } }>("/api/finance/budgets", async (request) => ({ data: await FinanceBudgetService.upsert(await browserServiceContext(request, secret, users), request.body) }));
  app.get<{ Querystring: { month: string } }>("/api/finance/budgets/status", async (request) => ({ data: await FinanceBudgetService.status(await browserServiceContext(request, secret, users), request.query.month) }));
};
