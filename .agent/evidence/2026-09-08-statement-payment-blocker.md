# Statement payment investigation — 2026-09-08

## Result

BLOCKED: the requested payment correction cannot be implemented safely in the
active backend repository because the Java migration removed the implementation
and its route. No production or financial data was mutated.

## Evidence

- Active BE `f218da9` removes `backend/src/services/statement-payment-command-service.ts`,
  `backend/src/transaction-routes.ts`, the MCP implementation, and their tests.
- `MIGRATION_STATUS.md` explicitly lists REST, financial, statement-payment and
  MCP capabilities as not yet ported.
- Active Java source exposes only `/health` and `/ready` in
  `src/main/java/com/devsecopslonghn/cardcredit/shared/HealthController.java`.
- FE calls `POST /api/cards/:id/statements/:statementId/payment/preview` and
  `PATCH /api/cards/:id/statements/:statementId/payment` from
  `src/lib/api/statementsClient.ts`, passing the statement's `userCardId` and
  `_id`.
- Argo is healthy, but deployment still uses the compatible Node image
  `ghcr.io/devsecopslonghn/card-credit-be:d2cee5e00caf950a91deedac1ef084ad49d641b4`.
- The historical Node service selected all `STATEMENT_PAYMENT` transactions
  without excluding `voidedAt`; this can make a reversed historical payment
  block a replacement payment. Its existing test checks the Mongo partial
  index but does not execute this voided-ledger case.

## Verification

`./.agent/gates/verify.sh` passes for the active Java bootstrap. This does not
prove payment compatibility; it is the verification gap that blocks a safe
runtime fix.

## Required next step

Port the statement-payment command boundary (including voided-payment ledger
filtering and regression coverage) into the active Java backend, then add the
REST/auth compatibility gates before changing the chart image tag.
