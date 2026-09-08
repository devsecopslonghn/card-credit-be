import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { DEFAULT_SESSION_MAX_AGE_MS, sessionCookie, sessionFromRequest, signSession, type Session } from "./auth.js";
import type { AuthRepository, AuthUser } from "./auth-repository.js";
import { browserActorContext } from "./context.js";
import { authSessionListSchema, authSessionSchema } from "@card-credit/contracts";
import type { MailService } from "./mail-service.js";
import { AuthSessionService } from "./services/auth-session-service.js";
import { AuthRegistrationService } from "./services/auth-registration-service.js";
import { ForgotPasswordService, PasswordResetService } from "./services/password-reset-service.js";
import { AuthBootstrapService } from "./services/auth-bootstrap-service.js";
import { normalizeEmail } from "./services/auth-policy.js";

export type AuthOptions = {
  repository: AuthRepository;
  secret: string;
  bootstrapToken?: string;
  configuredUsers?: Array<Record<string, unknown>>;
  returnResetToken?: boolean;
  mail?: Pick<MailService, "sendPasswordResetEmail">;
  sessionMaxAgeMs?: number;
  audit?: (event: string, request: FastifyRequest, actor?: Session | null, email?: string | null, resource?: Record<string, unknown>) => Promise<void>;
};
const publicUser = (session: Session) => ({ email: session.email, role: session.role, workspaceId: session.workspaceId });
const toSession = (user: AuthUser): Session => ({ userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId, sessionVersion: user.sessionVersion ?? 0 });

export const registerAuthRoutes = (app: FastifyInstance, options: AuthOptions) => {
  const audit = options.audit ?? (async () => {});
  app.post<{ Body: Record<string, unknown> }>("/api/auth/login", async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    try { const session = await AuthSessionService.login(email, request.body?.password, options.repository); const safeUser = authSessionSchema.parse(publicUser(session)); await audit("LOGIN_SUCCESS", request, session, email, { type: "auth", action: "login" }); reply.header("set-cookie", sessionCookie(signSession(session, options.secret), Math.floor((options.sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS) / 1000))); return { user: safeUser }; }
    catch (error) { await audit("LOGIN_FAILURE", request, null, email, { type: "auth", action: "login", errorCode: error instanceof ApiError ? error.code : "UNKNOWN" }); throw error; }
  });
  app.get("/api/auth/me", async (request) => { const { actor } = await browserActorContext(request, options.secret, options.repository); return { user: authSessionSchema.parse(publicUser(actor)) }; });
  app.post("/api/auth/logout", async (request, reply) => { let actor: Session | null = null; try { actor = sessionFromRequest(request, options.secret); } catch { actor = null; } await audit("LOGOUT", request, actor, actor?.email, { type: "auth", action: "logout" }); reply.header("set-cookie", sessionCookie("", 0)); return { ok: true }; });
  app.post<{ Body: Record<string, unknown> }>("/api/auth/register", async (request, reply) => {
    const email = normalizeEmail(request.body?.email);
    if ("workspaceId" in (request.body ?? {})) throw new ApiError(400, "WORKSPACE_SELECTION_NOT_ALLOWED", "Workspace được cấp tự động khi đăng ký.");
    const session = await AuthRegistrationService.register(email, request.body?.password, request.body?.displayName, options.repository); const safeUser = authSessionSchema.parse(publicUser(session)); await audit("LOGIN_SUCCESS", request, session, email, { type: "auth", action: "register" }); reply.status(201).header("set-cookie", sessionCookie(signSession(session, options.secret), Math.floor((options.sessionMaxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS) / 1000))); return { user: safeUser };
  });
  app.post<{ Body: Record<string, unknown> }>("/api/auth/forgot-password", async (request) => {
    const host = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "127.0.0.1:3001");
    const protocol = String(request.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
    const result = await ForgotPasswordService.request(request.body?.email, { repository: options.repository, resetBaseUrl: `${protocol}://${host}`, returnResetToken: options.returnResetToken, mail: options.mail });
    await audit("PASSWORD_RESET_REQUESTED", request, null, result.email, { type: "auth", action: "forgot-password", delivered: result.delivered });
    return { ok: true, message: "Nếu email tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi.", ...(result.resetLink ? { resetLink: result.resetLink } : {}) };
  });
  app.post<{ Body: Record<string, unknown> }>("/api/auth/reset-password", async (request, reply) => { const rawToken = typeof request.body?.token === "string" ? request.body.token.trim() : ""; const user = await PasswordResetService.complete(rawToken, request.body?.password, options.repository); await audit("PASSWORD_RESET_COMPLETED", request, toSession(user), user.email, { type: "auth", action: "reset-password" }); reply.header("set-cookie", sessionCookie("", 0)); return { ok: true };
  });
  app.post("/api/auth/bootstrap-users", async (request) => {
    if (!options.bootstrapToken) throw new ApiError(503, "BOOTSTRAP_DISABLED", "Bootstrap user API chưa được bật."); const authorization = request.headers.authorization ?? ""; const provided = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : String(request.headers["x-bootstrap-token"] ?? ""); if (provided !== options.bootstrapToken) throw new ApiError(403, "FORBIDDEN", "Bootstrap token không hợp lệ."); const users = await AuthBootstrapService.run(options.configuredUsers ?? [], options.repository); const results = users.map((user) => authSessionSchema.parse(publicUser(toSession(user))));
    await audit("USER_BOOTSTRAPPED", request, null, null, { type: "auth", action: "bootstrap-users", count: results.length }); return { users: authSessionListSchema.parse(results) };
  });
};
