import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import type { AuthRepository, AuthUser } from "./auth-repository.js";
import { browserServiceContext } from "./context.js";
import { AdminAuditService } from "./services/admin-audit-service.js";
import { AdminUserService } from "./services/admin-user-service.js";
import { ProfileService } from "./services/profile-service.js";
import { userListSchema, userSchema } from "@card-credit/contracts";

const serialize = (user: AuthUser) => ({ id: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId, displayName: user.displayName, active: user.active, lockedAt: user.lockedAt instanceof Date ? user.lockedAt.toISOString() : user.lockedAt ?? null });
export const registerUserRoutes = (app: FastifyInstance, users: AuthRepository, secret: string) => {
  const adminContext = async (request: FastifyRequest) => { const context = await browserServiceContext(request, secret, users); if (context.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này."); return context; };
  app.get("/api/profile", async (request) => { const context = await browserServiceContext(request, secret, users); const user = await ProfileService.get(context, users); return { user: userSchema.parse(serialize(user)) }; });
  app.patch<{ Body: Record<string, unknown> }>("/api/profile", async (request) => { const context = await browserServiceContext(request, secret, users); const user = await ProfileService.update(context, request.body ?? {}, users); return { user: userSchema.parse(serialize(user)) }; });
  app.get<{ Querystring: { limit?: string; cursor?: string } }>("/api/admin/users", async (request) => { const context = await adminContext(request); if (!request.query.limit && !request.query.cursor) return { users: userListSchema.parse((await AdminUserService.list(context, users)).map(serialize)) }; const page = await AdminUserService.listPage(context, users, request.query); return { users: userListSchema.parse(page.users.map(serialize)), nextCursor: page.nextCursor, limit: page.limit }; });
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/admin/users/:id", async (request) => { const context = await adminContext(request); const user = await AdminUserService.update(context, request.params.id, request.body ?? {}, users); if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng."); return { user: userSchema.parse(serialize(user)) }; });
  app.get<{ Querystring: { event?: string; userId?: string; email?: string; resourceType?: string; resourceId?: string; limit?: string; cursor?: string } }>("/api/admin/audit-logs", async (request) => { await adminContext(request); return AdminAuditService.list(request.query); });
};
