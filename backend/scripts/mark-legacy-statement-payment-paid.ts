import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import { canonicalPayloadHash } from "../src/command-hash.js";
import { reconciliationIdOf } from "../src/finance-reconciliation.js";
import { FinancialReconciliationCaseModel } from "../src/models/financial-reconciliation-case.js";
import { markLegacyStatementPaymentPaid } from "../src/services/legacy-payment-reconciliation-service.js";

const uri = process.env.MONGODB_URI?.trim();
const workspaceId = process.env.FINANCE_MIGRATION_WORKSPACE_ID?.trim();
const caseId = process.env.FINANCE_RECONCILIATION_CASE_ID?.trim();
const sourceHash = process.env.FINANCE_RECONCILIATION_SOURCE_HASH?.trim().toLowerCase();
const planHash = process.env.FINANCE_RECONCILIATION_PLAN_HASH?.trim().toLowerCase();
const currentSourceHash = process.env.FINANCE_RECONCILIATION_CURRENT_SOURCE_HASH?.trim().toLowerCase() || sourceHash;
const currentPlanHash = process.env.FINANCE_RECONCILIATION_CURRENT_PLAN_HASH?.trim().toLowerCase() || planHash;
const expectedStatus = process.env.FINANCE_RECONCILIATION_EXPECTED_STATUS?.trim();
const operatorId = process.env.FINANCE_RECONCILIATION_OPERATOR_ID?.trim();
const idempotencyKey = process.env.FINANCE_RECONCILIATION_IDEMPOTENCY_KEY?.trim();
const planFile = process.env.FINANCE_RECONCILIATION_PLAN_FILE?.trim();
const planSha256 = process.env.FINANCE_RECONCILIATION_PLAN_SHA256?.trim().toLowerCase();
const backupFile = process.env.FINANCE_RECONCILIATION_BACKUP_FILE?.trim();
const backupSha256 = process.env.FINANCE_RECONCILIATION_BACKUP_SHA256?.trim().toLowerCase();

if (!uri) throw new Error("MONGODB_URI is required");
if (!workspaceId || !caseId || !sourceHash || !planHash || !expectedStatus || !operatorId || !idempotencyKey) throw new Error("workspace, case, review hashes, expected status, operator and idempotency key are required");
if (process.env.FINANCE_RECONCILIATION_ALLOW !== "true") throw new Error("FINANCE_RECONCILIATION_ALLOW=true is required for mark-paid writes");
if (!planFile || !/^[a-f0-9]{64}$/.test(planSha256 ?? "") || !backupFile || !/^[a-f0-9]{64}$/.test(backupSha256 ?? "")) throw new Error("Reviewed plan and private backup with SHA-256 are required");
if (![sourceHash, planHash, currentSourceHash, currentPlanHash].every((value) => /^[a-f0-9]{64}$/.test(value ?? ""))) throw new Error("Review hashes must be SHA-256 digests");
if (!(expectedStatus === "OPEN" || expectedStatus === "STATEMENT_CLOSED")) throw new Error("FINANCE_RECONCILIATION_EXPECTED_STATUS must be OPEN or STATEMENT_CLOSED");
if (!/^[a-f0-9]{24}$/i.test(caseId)) throw new Error("FINANCE_RECONCILIATION_CASE_ID must be a Mongo ObjectId");

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const privateFile = async (file: string, label: string) => {
  const stat = await fs.stat(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${label} must be a private file`);
  return fs.readFile(file, "utf8");
};
const idsIn = (rows: unknown[], field: string) => new Set(rows.map((row) => row && typeof row === "object" ? reconciliationIdOf((row as Record<string, unknown>)[field]) : "").filter(Boolean));

await mongoose.connect(uri);
try {
  const reconciliationCase = await FinancialReconciliationCaseModel.findOne({ _id: caseId, workspaceId } as never).lean() as { statementId?: unknown; transactionId?: unknown } | null;
  if (!reconciliationCase) throw new Error("Reconciliation case was not found in the requested workspace");
  const statementId = reconciliationIdOf(reconciliationCase.statementId);
  const transactionId = reconciliationIdOf(reconciliationCase.transactionId);

  const planText = await privateFile(planFile, "FINANCE_RECONCILIATION_PLAN_FILE");
  if (digest(planText) !== planSha256) throw new Error("Reconciliation plan file hash mismatch");
  const artifact = JSON.parse(planText) as { artifactVersion?: number; workspaceId?: string; sourceHash?: string; planHash?: string; plan?: unknown };
  if (artifact.artifactVersion !== 1 || artifact.workspaceId !== workspaceId || artifact.sourceHash !== currentSourceHash || artifact.planHash !== currentPlanHash || !artifact.plan || canonicalPayloadHash(artifact.plan) !== currentPlanHash) throw new Error("Reviewed reconciliation plan artifact does not match the current operator hashes");
  const artifactPlan = artifact.plan as { repairs?: Array<{ statementId?: unknown; transactionId?: unknown }> };
  if (!(artifactPlan.repairs ?? []).some((item) => String(item.statementId ?? "") === statementId && String(item.transactionId ?? "") === transactionId)) throw new Error("Reviewed reconciliation plan does not contain the case target");

  const backupText = await privateFile(backupFile, "FINANCE_RECONCILIATION_BACKUP_FILE");
  if (digest(backupText) !== backupSha256) throw new Error("Backup file hash mismatch");
  const backup = JSON.parse(backupText) as { backupVersion?: number; workspaceId?: string; collections?: Record<string, unknown[]> };
  if (backup.backupVersion !== 1 || backup.workspaceId !== workspaceId || !Array.isArray(backup.collections?.cardstatements) || !Array.isArray(backup.collections?.financialtransactions)) throw new Error("Backup manifest is invalid or incomplete");
  if (!idsIn(backup.collections.cardstatements, "_id").has(statementId) || !idsIn(backup.collections.financialtransactions, "_id").has(transactionId)) throw new Error("Backup does not contain the reviewed case targets");

  const context = { workspaceId, userId: operatorId, role: "admin" as const, channel: "job" as const, correlationId: randomUUID() };
  const result = await markLegacyStatementPaymentPaid(context, { caseId, sourceHash, planHash, currentSourceHash: currentSourceHash!, currentPlanHash: currentPlanHash!, expectedStatus: expectedStatus as "OPEN" | "STATEMENT_CLOSED", idempotencyKey });
  console.log(JSON.stringify({ ...result, workspaceId, caseId, operatorId, sourceHash, planHash, currentSourceHash, currentPlanHash }));
} finally {
  await mongoose.disconnect();
}
