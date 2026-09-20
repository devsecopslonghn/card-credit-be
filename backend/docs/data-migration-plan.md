# Canonical data migration plan

## Bytebase target

- Bytebase instance: `mongodb-atlas-jrcf`.
- Database: `card-credit`.
- Bytebase project: `projects/card-credit-db-hvjd`; the Kubernetes runtime is configured for database `card-credit`. Verify the Bytebase database assignment after re-authentication before the next migration.
- Expected MCP database resource: `instances/mongodb-atlas-jrcf/databases/card-credit`.
- The historical source database was `test`; runtime and future migrations must target `card-credit` only.

## Current decision

- `CreditCard` is catalog-first. Runtime records use only `presetId`, the catalog snapshot fields and operational card fields. `bank`, `name`, `type`, `monthlyData` and card-level monthly/debt snapshots are migration-only input fields and are not part of the runtime schema or DTO.
- `CardStatement`, `FinancialTransaction`, `MonthlyCardCashback` and `CardFeePayment` are the financial sources of truth.
- `CommandReceipt`, `CommandPreview` and `CommandAudit` are the command/idempotency sources of truth. `McpMutation` is not used by application command services.
- `banks` and `cardtypes` are global master data. Their models carry `scope: GLOBAL`; they are not workspace data.
- User, token, audit-log and calendar-note collections now have Mongoose schema/index owners. Domain writes still require `workspaceId` where the entity is workspace-scoped.

## Observed production preflight

The read-only inspection of `mongodb-atlas-jrcf` / `card-credit` found:

- `creditcards`: 5 canonical documents, all workspace-scoped and without legacy card fields.
- `cardstatements`: 16 documents; `financialtransactions`: 92 documents, of which 91 are active and 1 is voided for audit history.
- The current preflight found no orphan card, statement, account, fee or cashback references. The 6 accounts contain 5 valid credit-card links and 1 non-credit account.
- `mcpmutations` still contains 17 historical rows although runtime idempotency is now owned by `commandreceipts`, `commandpreviews` and `commandaudits`.
- The previous card cleanup and migration were completed before the database cutover; no card identity was inferred during the finance normalization.
- Command-guard and data-integrity index checks were applied and verified with zero duplicate receipt, preview, payment, device or card groups.
- `cardproducts` contains the global catalog rows; `banks` and `cardtypes` are empty global master-data collections. The required card and financial indexes already exist.
- Canonical finance normalization found and repaired 13 transaction/account-type mismatches and 8 settled receivables whose stored current balance was stale. Post-migration checks report zero mismatches and zero unresolved account references.

## Safe execution order

1. Completed: Kubernetes runtime uses `card-credit`; verify that Bytebase project `projects/card-credit-db-hvjd` is assigned to the same database after re-authentication and before each rollout.
2. Take the MongoDB Atlas snapshot/export required by the operational policy. Record counts for `creditcards`, `accounts`, `cardstatements`, `financialtransactions`, `commandreceipts`, `commandpreviews`, `commandaudits` and `mcpmutations`.
3. The historical card migration and unowned-card archive were completed before the `test` to `card-credit` cutover. Do not rerun them against `card-credit` unless a new dry-run identifies a concrete issue.
4. Completed: current `card-credit` preflight reports 5 canonical cards, all workspace-scoped, with zero legacy fields and zero orphan references.
5. Completed: command-guard and data-integrity indexes were applied and verified. Keep `mcpmutations` read-only until its export/audit is complete; remove it only through a separate approved cleanup plan.
6. Completed: backed up the complete `longhn0710-workspace` from `card-credit` before finance normalization.
7. Completed: applied `normalize:canonical-finance` in a Mongo transaction. The migration is idempotent and has no default workspace or database.
8. Deploy the canonical runtime only after verification. Do not make migration a startup side effect.

The migration is intentionally not an automatic startup mutation. A deployment must not silently guess a card identity, workspace owner, or rewrite financial history.
