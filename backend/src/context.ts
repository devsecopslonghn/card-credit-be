import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { sessionFromRequest, type Session } from "./auth.js";
import { ApiError } from "./errors.js";
import type { AuthRepository } from "./auth-repository.js";
import type { ServiceChannel, ServiceContext, ServiceRole } from "./services/types/service-context.js";

const trustedRole = (role: string): ServiceRole => {
  if (role === "admin" || role === "user") return role;
  throw new ApiError(403, "INVALID_CONTEXT", "Trusted role không hợp lệ.");
};

const trustedCorrelationId = (value?: string) => {
  const correlationId = value?.trim() || randomUUID();
  if (correlationId.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(correlationId)) {
    throw new ApiError(400, "INVALID_CORRELATION_ID", "Correlation ID không hợp lệ.");
  }
  return correlationId;
};

export const serviceContextFromSession = (
  session: Pick<Session, "workspaceId" | "userId" | "role">,
  channel: ServiceChannel,
  correlationId: string = randomUUID(),
): ServiceContext => ({
  workspaceId: session.workspaceId,
  userId: session.userId,
  role: trustedRole(session.role),
  channel,
  correlationId: trustedCorrelationId(correlationId),
});

export const browserServiceContext = async (
  request: FastifyRequest,
  secret: string,
  users?: Pick<AuthRepository, "findUserById">,
): Promise<ServiceContext> => {
  if (!users) {
    const session = sessionFromRequest(request, secret);
    return serviceContextFromSession(session, "browser", request.id || randomUUID());
  }
  return (await browserActorContext(request, secret, users)).context;
};

export const browserActorContext = async (
  request: FastifyRequest,
  secret: string,
  users: Pick<AuthRepository, "findUserById">,
): Promise<{ context: ServiceContext; actor: Session }> => {
  const session = sessionFromRequest(request, secret);
  let user;
  try { user = await users.findUserById(session.userId); } catch { user = null; }
  if (!user || !user.active || user.lockedAt || user.workspaceId !== session.workspaceId || (user.sessionVersion ?? 0) !== (session.sessionVersion ?? 0)) {
    throw new ApiError(401, "UNAUTHENTICATED", "Phiên đăng nhập không còn hợp lệ.");
  }
  return {
    context: serviceContextFromSession({ userId: user.id, workspaceId: user.workspaceId, role: user.role }, "browser", request.id || randomUUID()),
    actor: { userId: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId },
  };
};

export const mcpServiceContext = (identity: Pick<Session, "workspaceId" | "userId" | "role"> & Pick<Session, "sessionVersion">): ServiceContext => {
  const context = serviceContextFromSession(identity, "mcp");
  return identity.sessionVersion === undefined ? context : { ...context, sessionVersion: identity.sessionVersion };
};

export const jobServiceContext = (identity: Pick<Session, "workspaceId" | "userId" | "role">, correlationId?: string): ServiceContext =>
  serviceContextFromSession(identity, "job", correlationId);
