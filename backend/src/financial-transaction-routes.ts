import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import { FinancialTransactionService, type CreateFinancialTransactionInput } from "./services/financial-transaction-service.js";
import type { AuthRepository } from "./auth-repository.js";
import { createFinancialTransactionInputSchema, financialTransactionListQuerySchema, updateFinancialTransactionInputSchema } from "@card-credit/contracts";
import { ApiError } from "./errors.js";

type Body = Partial<CreateFinancialTransactionInput>;

export const registerFinancialTransactionRoutes = (app: FastifyInstance, secret: string, users?: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { accountId?: string; categoryId?: string; from?: string; to?: string; limit?: string } }>("/api/financial-transactions", async (request) => ({
    data: await FinancialTransactionService.list(
      await browserServiceContext(request, secret, users),
      (() => {
        const parsed = financialTransactionListQuerySchema.safeParse({
          ...request.query,
          ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
        });
        if (!parsed.success) throw new ApiError(400, "INVALID_TRANSACTION_FILTER", "Bộ lọc giao dịch không hợp lệ.");
        return parsed.data;
      })(),
    ),
  }));

  app.post<{ Body: Body }>("/api/financial-transactions", async (request, reply) => {
    const parsed = createFinancialTransactionInputSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "INVALID_TRANSACTION", "Dữ liệu giao dịch không hợp lệ.");
    const rawIdempotencyKey = request.headers["idempotency-key"];
    if (typeof rawIdempotencyKey !== "string" || rawIdempotencyKey.trim().length < 8) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Tạo giao dịch cần Idempotency-Key tối thiểu 8 ký tự.");
    const idempotencyKey = rawIdempotencyKey.trim();
    const data = await FinancialTransactionService.create(
      await browserServiceContext(request, secret, users),
      parsed.data as CreateFinancialTransactionInput,
      { idempotencyKey, endpointOrTool: "POST /api/financial-transactions" },
    );
    return reply.code(201).send({ data });
  });
  app.patch<{ Params: { id: string }; Body: Body }>("/api/financial-transactions/:id", async (request) => {
    const parsed = updateFinancialTransactionInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ApiError(400, "INVALID_TRANSACTION", "Dữ liệu giao dịch cập nhật không hợp lệ.");
    const rawIdempotencyKey = request.headers["idempotency-key"];
    if (typeof rawIdempotencyKey !== "string" || rawIdempotencyKey.trim().length < 8) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Sửa giao dịch cần Idempotency-Key tối thiểu 8 ký tự.");
    return { data: await FinancialTransactionService.update(await browserServiceContext(request, secret, users), request.params.id, parsed.data, { idempotencyKey: rawIdempotencyKey.trim(), endpointOrTool: "PATCH /api/financial-transactions/:id" }) };
  });
  app.delete<{ Params: { id: string } }>("/api/financial-transactions/:id", async (request) => {
    const rawIdempotencyKey = request.headers["idempotency-key"];
    if (typeof rawIdempotencyKey !== "string" || rawIdempotencyKey.trim().length < 8) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Xóa giao dịch cần Idempotency-Key tối thiểu 8 ký tự.");
    return { data: await FinancialTransactionService.delete(await browserServiceContext(request, secret, users), request.params.id, { idempotencyKey: rawIdempotencyKey.trim(), endpointOrTool: "DELETE /api/financial-transactions/:id" }) };
  });
};
