# Canonical data migration plan

## Current decision

- `CreditCard` is catalog-first. Runtime records use only `presetId`, the catalog snapshot fields and operational card fields. `bank`, `name`, `type`, `monthlyData` and card-level monthly/debt snapshots are migration-only input fields and are not part of the runtime schema or DTO.
- `CardStatement`, `FinancialTransaction`, `MonthlyCardCashback` and `CardFeePayment` are the financial sources of truth.
- `CommandReceipt`, `CommandPreview` and `CommandAudit` are the command/idempotency sources of truth. `McpMutation` is not used by application command services.
- `banks` and `cardtypes` are global master data. Their models carry `scope: GLOBAL`; they are not workspace data.
- User, token, audit-log and calendar-note collections now have Mongoose schema/index owners. Domain writes still require `workspaceId` where the entity is workspace-scoped.

## Safe execution order

1. Run `npm run migrate:canonical-cards` without `--apply` and review `unresolved`.
2. Resolve cards that cannot map uniquely to a catalog product; do not guess a preset.
3. Run the same command with `--apply` during a controlled maintenance window. It only updates cards that map uniquely and unsets legacy card snapshots.
4. Run the existing data-integrity and command-guard index jobs.
5. Verify the unresolved count is zero and that the migrated documents no longer contain legacy keys before deploying the canonical runtime.

The migration is intentionally not an automatic startup mutation. A deployment must not silently guess a card identity or rewrite financial history.
