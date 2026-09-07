export type RestSecurity = "public" | "session" | "admin" | "bearer" | "calendar-token";
export type RestEndpointDefinition = {
  method: string;
  path: string;
  summary: string;
  security: RestSecurity;
};

/**
 * Documentation inventory. Route registration parity is deliberately tested
 * separately; this manifest must not be treated as authorization or routing.
 */
export const REST_ENDPOINTS: readonly RestEndpointDefinition[] = [
  { method: "get", path: "/health", summary: "Process liveness", security: "public" },
  { method: "get", path: "/ready", summary: "MongoDB readiness", security: "public" },
  { method: "post", path: "/api/auth/login", summary: "Login", security: "public" },
  { method: "post", path: "/api/auth/register", summary: "Register", security: "public" },
  { method: "get", path: "/api/auth/me", summary: "Current session", security: "session" },
  { method: "post", path: "/api/auth/logout", summary: "Logout", security: "public" },
  { method: "post", path: "/api/auth/forgot-password", summary: "Request password reset", security: "public" },
  { method: "post", path: "/api/auth/reset-password", summary: "Reset password", security: "public" },
  { method: "get", path: "/api/cards", summary: "List cards", security: "session" },
  { method: "post", path: "/api/cards", summary: "Create card", security: "session" },
  { method: "get", path: "/api/cards/{id}", summary: "Get card", security: "session" },
  { method: "put", path: "/api/cards/{id}", summary: "Update card", security: "session" },
  { method: "delete", path: "/api/cards/{id}", summary: "Delete card", security: "session" },
  { method: "get", path: "/api/cards/duplicates", summary: "Find duplicate cards", security: "session" },
  { method: "post", path: "/api/cards/duplicates", summary: "Merge duplicate cards", security: "session" },
  { method: "get", path: "/api/card-statements", summary: "List statements", security: "session" },
  { method: "get", path: "/api/cards/{id}/statements", summary: "List card statements", security: "session" },
  { method: "get", path: "/api/cards/{id}/statements/{statementId}", summary: "Get statement detail", security: "session" },
  { method: "post", path: "/api/cards/{id}/statements/{statementId}/payment/preview", summary: "Preview statement payment", security: "session" },
  { method: "patch", path: "/api/cards/{id}/statements/{statementId}/payment", summary: "Change statement payment status", security: "session" },
  { method: "post", path: "/api/cards/{id}/statements/{statementId}/calendar-email", summary: "Send statement calendar", security: "session" },
  { method: "get", path: "/api/cash-flow/monthly", summary: "Get monthly cash flow", security: "session" },
  { method: "get", path: "/api/notifications", summary: "List notifications", security: "session" },
  { method: "get", path: "/api/notes", summary: "List notes", security: "session" },
  { method: "post", path: "/api/notes", summary: "Upsert note", security: "session" },
  { method: "get", path: "/api/accounts", summary: "List financial accounts", security: "session" },
  { method: "post", path: "/api/accounts", summary: "Create financial account", security: "session" },
  { method: "post", path: "/api/accounts/merge/preview", summary: "Preview financial account merge", security: "session" },
  { method: "post", path: "/api/accounts/merge/confirm", summary: "Confirm financial account merge", security: "session" },
  { method: "get", path: "/api/financial-transactions", summary: "List unified financial transactions", security: "session" },
  { method: "post", path: "/api/financial-transactions", summary: "Create unified financial transaction", security: "session" },
  { method: "patch", path: "/api/financial-transactions/{id}", summary: "Update unified financial transaction", security: "session" },
  { method: "delete", path: "/api/financial-transactions/{id}", summary: "Delete unified financial transaction", security: "session" },
  { method: "get", path: "/api/financial-reports/summary", summary: "Get separated personal/debit/credit summary", security: "session" },
  { method: "get", path: "/api/finance/categories", summary: "List finance categories", security: "session" },
  { method: "post", path: "/api/finance/categories", summary: "Create finance category", security: "session" },
  { method: "put", path: "/api/finance/budgets", summary: "Set monthly budget", security: "session" },
  { method: "get", path: "/api/finance/budgets/status", summary: "Get budget status", security: "session" },
  { method: "get", path: "/api/finance/recurring-expenses", summary: "List recurring expenses", security: "session" },
  { method: "post", path: "/api/finance/recurring-expenses", summary: "Create recurring expense", security: "session" },
  { method: "put", path: "/api/finance/recurring-expenses/{id}", summary: "Update recurring expense", security: "session" },
  { method: "delete", path: "/api/finance/recurring-expenses/{id}", summary: "Deactivate recurring expense", security: "session" },
  { method: "get", path: "/api/card-catalog/providers", summary: "List active providers", security: "public" },
  { method: "get", path: "/api/card-catalog/products", summary: "List active products", security: "public" },
  { method: "get", path: "/api/card-catalog/products/{presetId}", summary: "Get active product", security: "public" },
  { method: "get", path: "/api/profile", summary: "Get profile", security: "session" },
  { method: "patch", path: "/api/profile", summary: "Update profile", security: "session" },
  { method: "get", path: "/api/calendar-subscriptions", summary: "List calendar subscriptions", security: "session" },
  { method: "post", path: "/api/calendar-subscriptions", summary: "Create calendar subscription", security: "session" },
  { method: "delete", path: "/api/calendar-subscriptions/{id}", summary: "Revoke calendar subscription", security: "session" },
  { method: "get", path: "/api/admin/audit-logs", summary: "List audit logs", security: "admin" },
  { method: "get", path: "/api/admin/card-catalog/products", summary: "List all catalog products", security: "admin" },
  { method: "post", path: "/api/admin/card-catalog/products", summary: "Create catalog product", security: "admin" },
  { method: "patch", path: "/api/admin/card-catalog/products/{presetId}", summary: "Update catalog product", security: "admin" },
  { method: "patch", path: "/api/admin/card-catalog/providers/{providerCode}", summary: "Update catalog provider", security: "admin" },
  { method: "get", path: "/api/admin/users", summary: "List users", security: "admin" },
  { method: "patch", path: "/api/admin/users/{id}", summary: "Update user", security: "admin" },
  { method: "post", path: "/api/auth/bootstrap-users", summary: "Bootstrap users", security: "bearer" },
  { method: "get", path: "/api/banks", summary: "List banks", security: "session" },
  { method: "post", path: "/api/banks", summary: "Create bank", security: "session" },
  { method: "put", path: "/api/banks/{id}", summary: "Update bank", security: "session" },
  { method: "delete", path: "/api/banks/{id}", summary: "Delete bank", security: "session" },
  { method: "get", path: "/api/cardtypes", summary: "List card types", security: "session" },
  { method: "post", path: "/api/cardtypes", summary: "Create card type", security: "session" },
  { method: "put", path: "/api/cardtypes/{id}", summary: "Update card type", security: "session" },
  { method: "delete", path: "/api/cardtypes/{id}", summary: "Delete card type", security: "session" },
  { method: "get", path: "/api/calendar-subscriptions/feed/{token}.ics", summary: "Download calendar feed", security: "calendar-token" },
  { method: "get", path: "/api/cards/{cardId}/monthly-cashbacks", summary: "List monthly cashback", security: "session" },
  { method: "put", path: "/api/cards/{cardId}/monthly-cashbacks/{period}", summary: "Upsert monthly cashback", security: "session" },
  { method: "delete", path: "/api/cards/{cardId}/monthly-cashbacks/{period}", summary: "Delete monthly cashback", security: "session" },
  { method: "get", path: "/api/fee-center", summary: "List fee center entries", security: "session" },
  { method: "post", path: "/api/fee-center", summary: "Create fee center entry", security: "session" },
  { method: "put", path: "/api/fee-center/{id}", summary: "Update fee center entry", security: "session" },
  { method: "delete", path: "/api/fee-center/{id}", summary: "Delete fee center entry", security: "session" },
  { method: "get", path: "/api/workspace/owner", summary: "Get workspace owner", security: "session" },
  { method: "put", path: "/api/workspace/owner", summary: "Set workspace owner", security: "session" },
] as const;

export const normalizeRestPath = (path: string) => path
  .replace(/:([^/|.]+)(?:\|:[^/|.]+)?/g, "{param}")
  .replace(/\{[^}]+\}/g, "{param}");

export const restEndpointKey = (endpoint: Pick<RestEndpointDefinition, "method" | "path">) => `${endpoint.method.toUpperCase()} ${normalizeRestPath(endpoint.path)}`;

/** Parses Fastify's public route tree output without depending on router internals. */
export const parseFastifyRouteInventory = (printedRoutes: string) => {
  const stack: string[] = [];
  const entries: string[] = [];
  for (const line of printedRoutes.split("\n")) {
    const marker = line.indexOf("├──") >= 0 ? "├──" : line.indexOf("└──") >= 0 ? "└──" : null;
    if (!marker) continue;
    const markerIndex = line.indexOf(marker);
    const match = line.slice(markerIndex + 4).match(/^(\/[^ ]*) \(([^)]+)\)$/);
    if (!match) continue;
    const depth = markerIndex / 4;
    stack.length = depth;
    stack[depth] = match[1]!;
    const path = normalizeRestPath(stack.slice(0, depth + 1).join(""));
    for (const method of match[2]!.split(",").map((value) => value.trim()).filter((value) => value !== "HEAD")) entries.push(`${method} ${path}`);
  }
  return [...new Set(entries)].sort();
};
