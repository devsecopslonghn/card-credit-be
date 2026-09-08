import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import { CommandAuditModel } from "../src/models/command-audit.js";
import { AccountModel } from "../src/models/account.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { FinancialReconciliationCaseModel } from "../src/models/financial-reconciliation-case.js";
import { canonicalPayloadHash } from "../src/command-hash.js";
import { planLegacyStatementPaymentRepairs, reconciliationIdOf, reconciliationPlanHash, reconciliationPlanPayload, type LegacyPaymentPlan, type LegacyPaymentRepair } from "../src/finance-reconciliation.js";

const uri = process.env.MONGODB_URI?.trim();
const workspaceId = process.env.FINANCE_MIGRATION_WORKSPACE_ID?.trim();
const mode = process.env.FINANCE_RECONCILIATION_MODE?.trim() || "dry-run";
const apply = mode === "quarantine";
const backupFile = process.env.FINANCE_RECONCILIATION_BACKUP_FILE?.trim() || "";
const expectedBackupSha256 = process.env.FINANCE_RECONCILIATION_BACKUP_SHA256?.trim().toLowerCase() || "";
const planFile = process.env.FINANCE_RECONCILIATION_PLAN_FILE?.trim() || "";
const expectedPlanSha256 = process.env.FINANCE_RECONCILIATION_PLAN_SHA256?.trim().toLowerCase() || "";
if (!uri) throw new Error("MONGODB_URI is required");
if (!workspaceId) throw new Error("FINANCE_MIGRATION_WORKSPACE_ID is required");
if (!["dry-run", "quarantine"].includes(mode)) throw new Error("FINANCE_RECONCILIATION_MODE must be dry-run or quarantine");
if (apply && process.env.FINANCE_RECONCILIATION_ALLOW !== "true") throw new Error("FINANCE_RECONCILIATION_ALLOW=true is required for quarantine writes");
if (apply) {
  if (!backupFile) throw new Error("FINANCE_RECONCILIATION_BACKUP_FILE is required for quarantine writes");
  if (!/^[a-f0-9]{64}$/.test(expectedBackupSha256)) throw new Error("FINANCE_RECONCILIATION_BACKUP_SHA256 must be a SHA-256 hex digest");
  if (!planFile) throw new Error("FINANCE_RECONCILIATION_PLAN_FILE is required for quarantine writes");
  if (!/^[a-f0-9]{64}$/.test(expectedPlanSha256)) throw new Error("FINANCE_RECONCILIATION_PLAN_SHA256 must be a SHA-256 hex digest");
}

const privateFile = async (file: string, label: string) => {
  const stat = await fs.stat(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a private file`);
  return fs.readFile(file, "utf8");
};
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const isObjectId = (value: string) => /^[a-f0-9]{24}$/i.test(value);
const artifactTargets = (artifactPlan: { repairs?: Array<{ statementId?: unknown; transactionId?: unknown }>; skipped?: Array<{ statementId?: unknown; transactionIds?: unknown }> }) => ({
  statementIds: [...(artifactPlan.repairs ?? []).map((item) => String(item.statementId ?? "")), ...(artifactPlan.skipped ?? []).map((item) => String(item.statementId ?? ""))].filter((id) => isObjectId(id)).sort(),
  transactionIds: [...(artifactPlan.repairs ?? []).map((item) => String(item.transactionId ?? "")), ...(artifactPlan.skipped ?? []).flatMap((item) => Array.isArray(item.transactionIds) ? item.transactionIds.map((id) => String(id)) : [])].filter((id) => isObjectId(id)).sort(),
});
const assertBackupAndPlan = async (currentPlan: LegacyPaymentPlan) => {
  const planText = await privateFile(planFile, "FINANCE_RECONCILIATION_PLAN_FILE");
  if (digest(planText) !== expectedPlanSha256) throw new Error("Reconciliation plan file hash does not match FINANCE_RECONCILIATION_PLAN_SHA256");
  const artifact = JSON.parse(planText) as { artifactVersion?: number; workspaceId?: string; sourceHash?: string; planHash?: string; plan?: { repairs?: unknown[]; skipped?: unknown[] } };
  if (artifact.artifactVersion !== 1 || artifact.workspaceId !== workspaceId || !artifact.plan || typeof artifact.sourceHash !== "string" || typeof artifact.planHash !== "string") throw new Error("Reconciliation plan artifact is invalid");
  if (artifact.sourceHash !== currentPlan.sourceHash || artifact.planHash !== reconciliationPlanHash(currentPlan) || canonicalPayloadHash(artifact.plan) !== artifact.planHash) throw new Error("Reconciliation plan no longer matches current source data");
  const targets = artifactTargets(artifact.plan as never);
  const statementIds = new Set(currentPlan.repairs.map((item) => item.statementId).concat(currentPlan.skipped.map((item) => item.statementId)).filter(isObjectId));
  const transactionIds = new Set(currentPlan.repairs.map((item) => item.transactionId).concat(currentPlan.skipped.flatMap((item) => item.transactionIds)).filter(isObjectId));
  if (JSON.stringify(targets.statementIds) !== JSON.stringify([...statementIds].sort()) || JSON.stringify(targets.transactionIds) !== JSON.stringify([...transactionIds].sort())) throw new Error("Reconciliation plan target allowlist does not match current source data");
  const backupText = await privateFile(backupFile, "FINANCE_RECONCILIATION_BACKUP_FILE");
  if (digest(backupText) !== expectedBackupSha256) throw new Error("Backup file hash does not match FINANCE_RECONCILIATION_BACKUP_SHA256");
  const backup = JSON.parse(backupText) as { backupVersion?: number; createdAt?: string; workspaceId?: string; collections?: Record<string, unknown[]> };
  if (backup.backupVersion !== 1 || !backup.createdAt || !Number.isFinite(Date.parse(backup.createdAt)) || backup.workspaceId !== workspaceId || !backup.collections || !Array.isArray(backup.collections.cardstatements) || !Array.isArray(backup.collections.financialtransactions)) throw new Error("Backup manifest is invalid or incomplete");
  const backupStatementIds = new Set(backup.collections.cardstatements.map((row) => reconciliationIdOf((row as Record<string, unknown>)._id)).filter(Boolean));
  const backupTransactionIds = new Set(backup.collections.financialtransactions.map((row) => reconciliationIdOf((row as Record<string, unknown>)._id)).filter(Boolean));
  if ([...statementIds].some((id) => !backupStatementIds.has(id)) || [...transactionIds].some((id) => !backupTransactionIds.has(id))) throw new Error("Backup does not contain every reviewed reconciliation target");
};

await mongoose.connect(uri);
try {
  const [statements, transactions, accounts] = await Promise.all([
    CardStatementModel.find({ workspaceId }).lean(),
    FinancialTransactionModel.find({ workspaceId }).lean(),
    AccountModel.find({ workspaceId }).lean(),
  ]);
  const plan = planLegacyStatementPaymentRepairs(statements as never[], transactions as never[], accounts as never[]);
  const correlationId = randomUUID();
  const currentPlanHash = reconciliationPlanHash(plan);
  if (!apply && planFile) {
    const artifact = { artifactVersion: 1, workspaceId, createdAt: new Date().toISOString(), sourceHash: plan.sourceHash, planHash: currentPlanHash, plan: reconciliationPlanPayload(plan) };
    await fs.writeFile(planFile, JSON.stringify(artifact, null, 2), { mode: 0o600 });
    await fs.chmod(planFile, 0o600);
  }
  if (apply) await assertBackupAndPlan(plan);
  let insertedCaseCount = 0;
  if (apply && (plan.repairs.length || plan.skipped.length)) {
    const duplicates = await FinancialReconciliationCaseModel.aggregate([
      { $match: { workspaceId, kind: "LEGACY_STATEMENT_PAYMENT" } },
      { $group: { _id: "$transactionId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]);
    if (duplicates.length) throw new Error("Existing reconciliation cases contain duplicate transaction IDs");
    await FinancialReconciliationCaseModel.createIndexes();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const cases = [
          ...plan.repairs.map((repair) => ({
            statementId: repair.statementId,
            transactionId: repair.transactionId,
            classification: "ELIGIBLE_MARK_PAID" as const,
            reason: "FULL_SETTLEMENT_REQUIRES_OPERATOR_APPROVAL",
            snapshot: { amount: repair.amount, accountId: repair.accountId, previousStatus: repair.previousStatus, paidAt: repair.paidAt.toISOString(), sourceHash: plan.sourceHash, planHash: currentPlanHash },
          })),
          ...plan.skipped.flatMap((item) => item.transactionIds.map((transactionId) => ({
            statementId: item.statementId,
            transactionId,
            classification: "QUARANTINE_REQUIRED" as const,
            reason: item.reason,
            snapshot: { transactionIds: item.transactionIds, sourceHash: plan.sourceHash, planHash: currentPlanHash },
          }))),
        ].filter((item) => isObjectId(item.statementId) && isObjectId(item.transactionId));
        for (const item of cases) {
          const result = await FinancialReconciliationCaseModel.updateOne(
            { workspaceId, kind: "LEGACY_STATEMENT_PAYMENT", transactionId: item.transactionId },
            { $setOnInsert: { workspaceId, kind: "LEGACY_STATEMENT_PAYMENT", statementId: item.statementId, transactionId: item.transactionId, classification: item.classification, reason: item.reason, snapshot: item.snapshot, status: "OPEN", resolvedAt: null } },
            { upsert: true, session },
          );
          const writeResult = result as unknown as { upsertedCount?: number; nUpserted?: number };
          if (Number(writeResult.upsertedCount ?? writeResult.nUpserted ?? 0) !== 1) continue;
          insertedCaseCount += 1;
          await CommandAuditModel.create([{
            workspaceId,
            userId: "system:reconciliation",
            channel: "job",
            correlationId,
            operation: "reconcile_legacy_statement_payment",
            endpointOrTool: "backend/scripts/reconcile-legacy-statement-payments.ts",
            previewId: null,
            resource: { type: "reconciliation_case", statementId: item.statementId, transactionId: item.transactionId, sourceHash: plan.sourceHash, planHash: currentPlanHash },
            outcome: "SUCCESS",
            errorCode: null,
          }], { session });
        }
      });
    } finally {
      await session.endSession();
    }
  }
  console.log(JSON.stringify({ mode, workspaceId, correlationId, sourceHash: plan.sourceHash, planHash: currentPlanHash, planFile: !apply && planFile ? planFile : null, candidateCount: plan.repairs.length, quarantineCount: plan.skipped.reduce((total, item) => total + item.transactionIds.length, 0), appliedCaseCount: insertedCaseCount, repairs: plan.repairs.map((repair: LegacyPaymentRepair) => ({ ...repair, paidAt: repair.paidAt.toISOString() })), skipped: plan.skipped }));
} finally {
  await mongoose.disconnect();
}
