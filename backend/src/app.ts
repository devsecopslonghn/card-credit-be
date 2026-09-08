import Fastify, { type FastifyRequest } from "fastify";
import type { DatabaseLifecycle } from "./database.js";
import { installErrorHandler, ApiError } from "./errors.js";
import { InMemoryCatalogRepository, invalidCatalogError, normalizeCatalogProduct, validateCatalogProducts, type CatalogProduct, type CatalogRepository } from "./catalog.js";
import type { Session } from "./auth.js";
import type { AuthRepository } from "./auth-repository.js";
import type { CatalogAuditWriter } from "./catalog-audit.js";
import { installBrowserSecurity } from "./browser-security.js";
import { catalogProductListSchema, catalogProductSchema, catalogProviderListSchema } from "@card-credit/contracts";
import { browserActorContext, browserServiceContext } from "./context.js";

const updateFields = new Set(["providerCode", "providerName", "displayName", "network", "segment", "annualFee", "targetSpendForWaiver", "imageUrl", "benefits", "sourceUrl", "sourceCheckedAt", "active", "sortOrder", "theme"]);
const auditFor = (session: Session) => ({ updatedBy: session.email, updatedByUserId: session.userId, updatedAt: new Date().toISOString(), storage: "mongodb:cardproducts" });
const validateWholeCatalog = async (catalog: CatalogRepository, candidate: CatalogProduct, replacing?: string) => {
  const all = await catalog.listAllProducts();
  if (!replacing && all.some((product) => product.presetId === candidate.presetId)) throw new ApiError(409, "INVALID_REQUEST", "Card Product đã tồn tại.", { presetId: "presetId bị trùng." });
  const next = replacing ? all.map((p) => p.presetId === replacing ? candidate : p) : [...all, candidate];
  const issues = validateCatalogProducts(next); if (issues.length) throw invalidCatalogError(issues);
};

export const buildApp = (database: Pick<DatabaseLifecycle, "isReady">, logLevel = "info", catalog: CatalogRepository = new InMemoryCatalogRepository(), authSecret = "test-secret-at-least-thirty-two-characters", writeAudit: CatalogAuditWriter = async () => {}, authUsers?: Pick<AuthRepository, "findUserById">) => {
  const app = Fastify({ logger: { level: logLevel, redact: ["req.headers.authorization", "req.headers.cookie", "password", "token", "mongodbUri"] }, requestIdHeader: "x-request-id" });
  installErrorHandler(app);
  installBrowserSecurity(app);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => database.isReady() ? { status: "ready" } : reply.status(503).send({ status: "not_ready" }));
  app.get("/api/card-catalog/providers", async () => ({ data: catalogProviderListSchema.parse(await catalog.listActiveProviders()) }));
  app.get<{ Querystring: { provider?: string } }>("/api/card-catalog/products", async (request) => { const provider = request.query.provider?.trim().toUpperCase(); const products = await catalog.listActiveProducts(provider); if (provider && products.length === 0) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Không tìm thấy provider đang hoạt động.", { provider }); return { data: catalogProductListSchema.parse(products) }; });
  app.get<{ Params: { presetId: string } }>("/api/card-catalog/products/:presetId", async (request) => { const product = await catalog.getActiveProduct(request.params.presetId); if (!product) throw new ApiError(404, "PRESET_NOT_FOUND", "Không tìm thấy Card Product."); return { data: catalogProductSchema.parse(product) }; });
  const admin = async (request: FastifyRequest) => {
    if (!authUsers) {
      await browserServiceContext(request, authSecret);
      throw new ApiError(503, "AUTH_REPOSITORY_UNAVAILABLE", "Dịch vụ xác thực chưa sẵn sàng.");
    }
    const { context, actor } = await browserActorContext(request, authSecret, authUsers);
    if (context.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
    return { context, actor };
  };
  app.get("/api/admin/card-catalog/products", async (request) => { const { actor } = await admin(request); const products = await catalog.listAllProducts(); return { data: products, audit: auditFor(actor) }; });
  app.post<{ Body: Record<string, unknown> }>("/api/admin/card-catalog/products", async (request, reply) => { const { actor } = await admin(request); const product = normalizeCatalogProduct(request.body ?? {}); await validateWholeCatalog(catalog, product); const created = await catalog.createProduct(product); await writeAudit({ event: "CATALOG_PRODUCT_CREATED", actor, request, resource: { type: "catalog_product", id: created.presetId, providerCode: created.providerCode } }); return reply.status(201).send({ data: created, audit: auditFor(actor) }); });
  app.patch<{ Params: { presetId: string }; Body: Record<string, unknown> }>("/api/admin/card-catalog/products/:presetId", async (request) => { const { actor } = await admin(request); const existing = (await catalog.listAllProducts()).find((p) => p.presetId === request.params.presetId); if (!existing) throw new ApiError(404, "PRESET_NOT_FOUND", "Không tìm thấy Card Product."); const entries = Object.entries(request.body ?? {}).filter(([key]) => updateFields.has(key)); if (!entries.length) throw new ApiError(400, "INVALID_REQUEST", "Không có field catalog hợp lệ để cập nhật."); const product = normalizeCatalogProduct({ ...existing, ...Object.fromEntries(entries) }); await validateWholeCatalog(catalog, product, existing.presetId); const updated = await catalog.updateProduct(existing.presetId, product); await writeAudit({ event: "CATALOG_PRODUCT_UPDATED", actor, request, resource: { type: "catalog_product", id: existing.presetId, providerCode: product.providerCode, fields: entries.map(([key]) => key) } }); return { data: updated!, audit: auditFor(actor) }; });
  app.patch<{ Params: { providerCode: string }; Body: { providerName?: unknown; active?: unknown } }>("/api/admin/card-catalog/providers/:providerCode", async (request) => { const { actor } = await admin(request); const providerCode = request.params.providerCode.toUpperCase(); const update = { ...(typeof request.body?.providerName === "string" ? { providerName: request.body.providerName.trim() } : {}), ...(typeof request.body?.active === "boolean" ? { active: request.body.active } : {}) }; if (!Object.keys(update).length) throw new ApiError(400, "INVALID_REQUEST", "Không có field provider hợp lệ để cập nhật."); const all = await catalog.listAllProducts(); const matching = all.filter((p) => p.providerCode === providerCode); if (!matching.length) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Không tìm thấy provider.", { provider: providerCode }); const issues = validateCatalogProducts(all.map((p) => p.providerCode === providerCode ? { ...p, ...update } : p)); if (issues.length) throw invalidCatalogError(issues); const affectedProducts = await catalog.updateProvider(providerCode, update); await writeAudit({ event: "CATALOG_PROVIDER_BULK_UPDATED", actor, request, resource: { type: "catalog_provider", id: providerCode, providerCode, affectedProducts, fields: Object.keys(update) } }); return { data: { providerCode, affectedProducts }, audit: auditFor(actor) }; });
  return app;
};
