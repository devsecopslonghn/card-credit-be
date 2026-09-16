# Canonical data migration plan

## Bytebase target

- Bytebase instance: `mongodb-atlas-jrcf`.
- Database: `test`.
- Current Bytebase state: database `test` is attached to the `default` project; no dedicated Card Credit project exists yet.
- Proposed project key: `card-credit-db`.
- This plan is read-only until the preflight checks pass. No production write was run while preparing it.

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
- Two `accounts` rows reference a missing card. They are cash accounts, including an old UAT smoke row; they require a separate cleanup decision and must not be silently deleted by card migration.
- `mcpmutations` still contains 17 historical rows although runtime idempotency is now owned by `commandreceipts`, `commandpreviews` and `commandaudits`.
- `cardproducts` contains 33 global catalog rows; `banks` and `cardtypes` are empty global master-data collections. The required card and financial indexes already exist.

## Safe execution order

1. In Bytebase, create project `card-credit-db` and attach `projects/card-credit-db/instances/mongodb-atlas-jrcf/databases/test` to the appropriate environment. Keep the existing `default` assignment until the project attachment is verified.
2. Take the MongoDB Atlas snapshot/export required by the operational policy. Record counts for `creditcards`, `accounts`, `cardstatements`, `financialtransactions`, `commandreceipts`, `commandpreviews`, `commandaudits` and `mcpmutations`.
3. Run `npm run migrate:canonical-cards` without `--apply` from the exact backend commit being deployed. The command now reports `mode: blocked` for `--apply` when any card lacks a workspace, so it cannot partially rewrite the collection.
4. Resolve the four workspace-less cards and the two orphan account references explicitly. Assign a workspace only when an authoritative owner/reference proves it; otherwise export and archive/remove them in a separately reviewed cleanup change.
5. Re-run the dry-run. The required gate is `unresolved: []`, with every candidate having a workspace and exactly one catalog product.
6. During a controlled maintenance window, run the same command with `--apply`. It writes the canonical catalog snapshot, normalizes `workspaceId`, and unsets `legacy`, `bank`, `name`, `type`, `monthlyData`, `statementDate`, `paymentDueDate`, `amountDueThisMonth` and `isPaidThisMonth` in one deterministic pass.
7. Verify: all `creditcards` have the canonical required fields, no legacy keys remain, every card has a workspace, card references from statements/cashbacks/fees resolve, and all workspace-scoped queries return the expected counts.
8. Run `npm run ensure:command-guard-indexes` and `npm run ensure:data-integrity-indexes`, then smoke-test REST and MCP with the same workspace. Keep `mcpmutations` read-only until its export/audit is complete; remove it in a separate approved cleanup plan because it is obsolete data, not a runtime compatibility path.
9. Deploy the canonical runtime only after verification. Do not make migration an application startup side effect.

The migration is intentionally not an automatic startup mutation. A deployment must not silently guess a card identity, workspace owner, or rewrite financial history.
