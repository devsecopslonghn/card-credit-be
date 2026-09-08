import mongoose from "mongoose";
import type { FastifyRequest } from "fastify";
import type { Session } from "./auth.js";

export type CatalogAuditEvent = {
  event: "CATALOG_PRODUCT_CREATED" | "CATALOG_PRODUCT_UPDATED" | "CATALOG_PROVIDER_BULK_UPDATED";
  actor: Session;
  request: FastifyRequest;
  resource: Record<string, unknown>;
};

export type CatalogAuditWriter = (event: CatalogAuditEvent) => Promise<void>;

export const writeCatalogAudit: CatalogAuditWriter = async ({ event, actor, request, resource }) => {
  await mongoose.connection.collection("authauditlogs").insertOne({
    event,
    userId: actor.userId,
    email: actor.email,
    role: actor.role,
    workspaceId: actor.workspaceId,
    ip: request.ip || null,
    userAgent: request.headers["user-agent"] || null,
    correlationId: request.id,
    resource,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export const writeAuthAudit = async (event: string, request: FastifyRequest, actor?: Session | null, email?: string | null, resource?: Record<string, unknown>) => {
  await mongoose.connection.collection("authauditlogs").insertOne({
    event, userId: actor?.userId ?? null, email: actor?.email ?? email ?? null,
    role: actor?.role ?? null, workspaceId: actor?.workspaceId ?? null,
    ip: request.ip || null, userAgent: request.headers["user-agent"] || null,
    correlationId: request.id, resource: resource ?? null, createdAt: new Date(), updatedAt: new Date(),
  });
};
