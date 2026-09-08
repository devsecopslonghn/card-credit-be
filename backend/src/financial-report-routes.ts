import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import { FinancialReportService } from "./services/financial-report-service.js";
import type { AuthRepository } from "./auth-repository.js";
import { ApiError } from "./errors.js";
import { reportQuerySchema, resolveReportDateRange } from "@card-credit/contracts";

export const registerFinancialReportRoutes = (app: FastifyInstance, secret: string, users?: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { from?: string; to?: string; cardId?: string; owner?: string; year?: string; month?: string } }>("/api/financial-reports/summary", async (request) => {
    const context = await browserServiceContext(request, secret, users);
    let range;
    let filters: { cardId?: string; owner?: string } = {};
    try {
      const query = reportQuerySchema.parse(request.query);
      range = resolveReportDateRange(query);
      filters = {
        ...(typeof query.cardId === "string" ? { cardId: query.cardId } : {}),
        ...(typeof query.owner === "string" ? { owner: query.owner } : {}),
      };
    } catch {
      throw new ApiError(400, "INVALID_DATE_RANGE", "Khoảng thời gian báo cáo không hợp lệ.");
    }
    return { data: await FinancialReportService.summary(context, range, Object.keys(filters).length ? filters : undefined) };
  });
};
