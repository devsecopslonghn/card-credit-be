import mongoose from "mongoose";
import { auditOrphanReferences } from "../src/finance-reconciliation.js";
import { buildCanonicalFinancePlan, type CanonicalAccountRecord, type CanonicalTransactionRecord } from "../src/canonical-finance.js";
const uri = process.env.MONGODB_URI?.trim();
const workspaceId = process.env.FINANCE_MIGRATION_WORKSPACE_ID?.trim();
if (!uri) throw new Error("MONGODB_URI is required");
if (!workspaceId) throw new Error("FINANCE_MIGRATION_WORKSPACE_ID is required");
await mongoose.connect(uri);
try {
  const db = mongoose.connection.db!;
  const [cards, statements, finance, accounts, fees, cashbacks] = await Promise.all([
    db.collection("creditcards").find({ workspaceId }).project({ _id: 1 }).toArray(),
    db.collection("cardstatements").find({ workspaceId }).project({ _id: 1, paymentStatus: 1, paidAmount: 1 }).toArray(),
    db.collection("financialtransactions").find({ workspaceId }).project({ _id: 1, accountId: 1, accountType: 1, statementId: 1, transactionType: 1, ownership: 1, amount: 1, reimbursementExpected: 1, outstandingReceivable: 1, receivableStatus: 1, receivableSettledAmount: 1, reimbursementForTransactionId: 1, voidedAt: 1, note: 1 }).toArray(),
    db.collection("accounts").find({ workspaceId }).project({ _id: 1, creditCardId: 1, type: 1 }).toArray(),
    db.collection("cardfeepayments").find({ workspaceId }).project({ _id: 1, userCardId: 1 }).toArray(),
    db.collection("monthlycardcashbacks").find({ workspaceId }).project({ _id: 1, userCardId: 1 }).toArray(),
  ]);
  const paidIds = new Set(statements.filter((item) => item.paymentStatus === "PAID" && Number(item.paidAmount ?? 0) > 0).map((item) => String(item._id)));
  const activeFinance = finance.filter((item) => !item.voidedAt);
  const syncedIds = new Set(activeFinance.filter((item) => item.transactionType === "STATEMENT_PAYMENT" && item.statementId).map((item) => String(item.statementId)));
  const sources = activeFinance.filter((item) => item.transactionType === "EXPENSE" && item.ownership === "PAID_FOR_OTHER");
  const collectedBySource = new Map<string, number>();
  for (const item of activeFinance) if (item.transactionType === "REIMBURSEMENT" && item.reimbursementForTransactionId) {
    const sourceId = String(item.reimbursementForTransactionId);
    collectedBySource.set(sourceId, (collectedBySource.get(sourceId) ?? 0) + Number(item.amount ?? 0));
  }
  for (const item of sources) if (["SETTLED", "COLLECTED"].includes(String(item.receivableStatus))) {
    const sourceId = String(item._id);
    collectedBySource.set(sourceId, Math.max(collectedBySource.get(sourceId) ?? 0, Number(item.receivableSettledAmount ?? item.reimbursementExpected ?? 0)));
  }
  const grossReceivable = sources.reduce((sum, item) => sum + Number(item.reimbursementExpected ?? 0), 0);
  const recordedReimbursements = [...collectedBySource.values()].reduce((sum, value) => sum + value, 0);
  const outstandingReceivable = sources.reduce((sum, item) => sum + Math.max(0, Number(item.reimbursementExpected ?? 0) - (collectedBySource.get(String(item._id)) ?? 0)), 0);
  const orphanReferences = auditOrphanReferences({ cards, statements, accounts, transactions: finance, fees, cashbacks });
  const canonicalPlan = buildCanonicalFinancePlan(accounts as CanonicalAccountRecord[], finance as CanonicalTransactionRecord[]);
  console.log(JSON.stringify({ workspaceId, sourceOfTruth: { balances: "accounts + financialtransactions", statementStatus: "cardstatements", accountType: "accounts.type", receivableGross: "financialtransactions.reimbursementExpected", receivableCurrent: "linked reimbursements + settlement metadata" }, counts: { cards: cards.length, statements: statements.length, paidStatements: paidIds.size, financialTransactions: finance.length, accounts: accounts.length, fees: fees.length, cashbacks: cashbacks.length, paidForOther: sources.length, reimbursements: activeFinance.filter((item) => item.transactionType === "REIMBURSEMENT").length }, statementSync: { paidWithAmount: statements.filter((item) => item.paymentStatus === "PAID" && Number(item.paidAmount ?? 0) > 0).length, syncedPayments: syncedIds.size, missingPayments: [...paidIds].filter((id) => !syncedIds.has(id)) }, receivable: { gross: grossReceivable, recordedReimbursements, net: outstandingReceivable }, canonicalFinance: { accountTypeMismatches: canonicalPlan.accountTypeUpdates.length, receivableFieldMismatches: canonicalPlan.receivableUpdates.length, unresolvedAccountReferences: canonicalPlan.unresolvedAccountReferences }, orphanReferences }));
} finally { await mongoose.disconnect(); }
