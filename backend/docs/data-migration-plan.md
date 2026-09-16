# Canonical data migration plan

## Bytebase target

- Bytebase instance: `mongodb-atlas-jrcf`.
- Database: `test`.
- Current Bytebase state: project `card-credit-db` exists as `projects/card-credit-db-hvjd`, and database `test` is attached to it.
- MCP database resource: `instances/mongodb-atlas-jrcf/databases/test`.
- The migration was executed only after the reviewed backup and zero-reference preflight passed. No financial history was rewritten.

## Current decision

- `CreditCard` is catalog-first. Runtime records use only `presetId`, the catalog snapshot fields and operational card fields. `bank`, `name`, `type`, `monthlyData` and card-level monthly/debt snapshots are migration-only input fields and are not part of the runtime schema or DTO.
- `CardStatement`, `FinancialTransaction`, `MonthlyCardCashback` and `CardFeePayment` are the financial sources of truth.
- `CommandReceipt`, `CommandPreview` and `CommandAudit` are the command/idempotency sources of truth. `McpMutation` is not used by application command services.
- `banks` and `cardtypes` are global master data. Their models carry `scope: GLOBAL`; they are not workspace data.
- User, token, audit-log and calendar-note collections now have Mongoose schema/index owners. Domain writes still require `workspaceId` where the entity is workspace-scoped.

## Observed production preflight

The read-only inspection of `mongodb-atlas-jrcf` / `test` found:

- `creditcards`: 14 documents; 10 have a workspace, 2 have incomplete canonical catalog snapshots, and all 14 still contain legacy card fields.
- Catalog matching is deterministic for all 14 cards when workspace ownership is ignored: 12 match by `presetId`, 2 match uniquely by provider/name, and none are catalog-ambiguous.
- Four cards have no `workspaceId`, no `userId`, and no statements. They are not safe to assign to a workspace by inference; two are empty/incomplete catalog rows and two are legacy UOB One/VIB Max Card rows.
- The current preflight found no orphan `accounts.creditCardId` references. The 8 accounts contain 5 valid credit-card links and 3 non-credit accounts; account cleanup is not part of this migration.
- `mcpmutations` still contains 17 historical rows although runtime idempotency is now owned by `commandreceipts`, `commandpreviews` and `commandaudits`.
- The four workspace-less cards were confirmed as test data and archived in `creditcardarchives`; their exact source documents were removed from `creditcards` only after the zero-reference preflight passed. The cleanup command is idempotent.
- The remaining 10 cards were migrated to the canonical catalog snapshot and all legacy card fields were removed. Post-migration verification found zero canonical-field gaps and zero orphan card references.
- Command-guard and data-integrity index checks were applied and verified with zero duplicate receipt, preview, payment, device or card groups.
- `cardproducts` contains 33 global catalog rows; `banks` and `cardtypes` are empty global master-data collections. The required card and financial indexes already exist.

## Safe execution order

1. Completed: Bytebase project `projects/card-credit-db-hvjd` owns `instances/mongodb-atlas-jrcf/databases/test` in the develop environment; verify this assignment before each rollout.
2. Take the MongoDB Atlas snapshot/export required by the operational policy. Record counts for `creditcards`, `accounts`, `cardstatements`, `financialtransactions`, `commandreceipts`, `commandpreviews`, `commandaudits` and `mcpmutations`.
3. Run `npm run migrate:canonical-cards` without `--apply` from the exact backend commit being deployed. The command now reports `mode: blocked` for `--apply` when any card lacks a workspace, so it cannot partially rewrite the collection.
4. Completed: `archive:unowned-test-cards` archived the four exact reviewed IDs after confirming zero statements, cashbacks, fees and account references; no other card was touched.
5. Completed preflight: the canonical-card dry-run now reports 10 cards and `unresolved: []`, with every remaining card having a workspace and exactly one catalog product.
6. Completed: the canonical migration applied to all 10 remaining cards. It wrote the canonical catalog snapshot, normalized `workspaceId`, and unset `legacy`, `bank`, `name`, `type`, `monthlyData`, `statementDate`, `paymentDueDate`, `amountDueThisMonth` and `isPaidThisMonth` in one deterministic pass.
7. Completed: post-migration verification found 10 canonical cards, no legacy keys, no missing workspace/catalog fields, and zero orphan references from statements, cashbacks, fees or accounts.
8. Completed: command-guard and data-integrity indexes were applied and verified. Smoke-test REST and MCP with the same workspace. Keep `mcpmutations` read-only until its export/audit is complete; remove it in a separate approved cleanup plan because it is obsolete data, not a runtime compatibility path.
9. Deploy the canonical runtime only after verification. Do not make migration an application startup side effect.

The migration is intentionally not an automatic startup mutation. A deployment must not silently guess a card identity, workspace owner, or rewrite financial history.
