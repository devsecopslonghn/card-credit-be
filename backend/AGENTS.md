# backend package

The backend owns application services, Mongo models, REST and MCP adapters.
Keep business rules in services/domain code, not transport handlers.

Run `npm run lint`, `npm run typecheck`, and `npm test` before handoff.
Financial mutations must use preview/confirm, command-guard idempotency,
Mongo transactions and append-only audit. Never confirm or mutate production
while developing. Keep `FinancialTransaction`, `CardStatement`, `Account` and
command receipt/audit models workspace-scoped.
