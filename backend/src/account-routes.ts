import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import { AccountService } from "./services/account-service.js";
import { createAccountInputSchema, mergeAccountsInputSchema } from "@card-credit/contracts";
import type { CreateAccountInput } from "@card-credit/contracts";
import type { AuthRepository } from "./auth-repository.js";
import { ApiError } from "./errors.js";
import { AccountService as MergeAccountService } from "./services/account-service.js";
import { createPreviewTokenCodec, confirmationTokenHash, canonicalPayloadHash } from "./mcp/preview.js";
import { previewConfirmationService } from "./services/preview-confirmation-service.js";

export const registerAccountRoutes = (app: FastifyInstance, secret: string, users?: Pick<AuthRepository, "findUserById">) => {
  const previewCodec = () => createPreviewTokenCodec({ secret: process.env.MCP_PREVIEW_SECRET?.trim() || secret });
  app.get<{ Querystring: { includeArchived?: string } }>("/api/accounts", async (request) => {
    return { data: await AccountService.list(await browserServiceContext(request, secret, users), { includeArchived: request.query.includeArchived === "true" }) };
  });

  app.post("/api/accounts", async (request, reply) => {
    const parsed = createAccountInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_ACCOUNT", message: "Dữ liệu tài khoản không hợp lệ." } });
    }
    const rawIdempotencyKey = request.headers["idempotency-key"];
    if (typeof rawIdempotencyKey !== "string" || rawIdempotencyKey.trim().length < 8) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Tạo tài khoản cần Idempotency-Key tối thiểu 8 ký tự.");
    const idempotencyKey = rawIdempotencyKey.trim();
    return reply.status(201).send({
      data: await AccountService.create(
        await browserServiceContext(request, secret, users),
        parsed.data as CreateAccountInput,
        { idempotencyKey, endpointOrTool: "POST /api/accounts" },
      ),
    });
  });

  app.post("/api/accounts/merge/preview", async (request) => {
    const parsed = mergeAccountsInputSchema.parse(request.body ?? {}) as { sourceAccountIds: string[]; targetAccountId?: string; targetName?: string; targetType?: "DEBIT" | "CASH" | "E_WALLET"; keepTargetAsCash?: boolean; expectedVersion?: number };
    const context = await browserServiceContext(request, secret, users);
    const preview = await MergeAccountService.previewMerge(context, parsed);
    const metadata = await previewConfirmationService.issue(context, "merge_accounts", parsed, previewCodec());
    return { data: { operation: "merge_accounts", ...preview, ...metadata } };
  });

  app.post("/api/accounts/merge/confirm", async (request) => {
    const body = (request.body ?? {}) as { payload?: unknown; previewId?: string; confirmationToken?: string };
    const parsed = mergeAccountsInputSchema.parse(body.payload ?? {}) as { sourceAccountIds: string[]; targetAccountId?: string; targetName?: string; targetType?: "DEBIT" | "CASH" | "E_WALLET"; keepTargetAsCash?: boolean; expectedVersion?: number };
    if (!body.previewId || !body.confirmationToken) throw new ApiError(400, "INVALID_PREVIEW_CONFIRMATION", "Cần previewId và confirmationToken.");
    const context = await browserServiceContext(request, secret, users);
    let verification;
    try { verification = previewCodec().verify(body.confirmationToken, "merge_accounts", parsed, { workspaceId: context.workspaceId, userId: context.userId, channel: context.channel }); } catch { throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới."); }
    if (verification.previewId !== body.previewId) throw new ApiError(409, "PREVIEW_NOT_AVAILABLE", "Preview không còn khả dụng; hãy tạo preview mới.");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.trim().length < 8) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Merge cần Idempotency-Key tối thiểu 8 ký tự.");
    return { data: await MergeAccountService.merge(context, parsed, { idempotencyKey: key.trim(), endpointOrTool: "POST /api/accounts/merge/confirm", previewId: body.previewId, confirmationTokenHash: confirmationTokenHash(body.confirmationToken), previewPayloadHash: canonicalPayloadHash(parsed) }) };
  });
};
