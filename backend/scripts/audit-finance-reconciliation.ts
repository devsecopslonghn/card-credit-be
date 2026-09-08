import mongoose from "mongoose";
import { auditOrphanReferences } from "../src/finance-reconciliation.js";
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
    db.collection("financialtransactions").find({ workspaceId }).project({ _id: 1, statementId: 1, transactionType: 1, ownership: 1, amount: 1, outstandingReceivable: 1, note: 1 }).toArray(),
    db.collection("accounts").find({ workspaceId }).project({ _id: 1, creditCardId: 1 }).toArray(),
    db.collection("cardfeepayments").find({ workspaceId }).project({ _id: 1, userCardId: 1 }).toArray(),
    db.collection("monthlycardcashbacks").find({ workspaceId }).project({ _id: 1, userCardId: 1 }).toArray(),
  ]);
  const paidIds = new Set(statements.filter((item) => item.paymentStatus === "PAID" && Number(item.paidAmount ?? 0) > 0).map((item) => String(item._id)));
  const syncedIds = new Set(finance.filter((item) => item.transactionType === "STATEMENT_PAYMENT" && item.statementId).map((item) => String(item.statementId)));
  const reimbursements = finance.filter((item) => item.transactionType === "REIMBURSEMENT").reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const grossReceivable = finance.reduce((sum, item) => sum + Number(item.outstandingReceivable ?? 0), 0);
  const orphanReferences = auditOrphanReferences({ cards, statements, accounts, transactions: finance, fees, cashbacks });
  console.log(JSON.stringify({ workspaceId, sourceOfTruth: { balances: "accounts + financialtransactions", statementStatus: "cardstatements" }, counts: { cards: cards.length, statements: statements.length, paidStatements: paidIds.size, financialTransactions: finance.length, accounts: accounts.length, fees: fees.length, cashbacks: cashbacks.length, paidForOther: finance.filter((item) => item.ownership === "PAID_FOR_OTHER").length, reimbursements: finance.filter((item) => item.transactionType === "REIMBURSEMENT").length }, statementSync: { paidWithAmount: statements.filter((item) => item.paymentStatus === "PAID" && Number(item.paidAmount ?? 0) > 0).length, syncedPayments: syncedIds.size, missingPayments: [...paidIds].filter((id) => !syncedIds.has(id)) }, receivable: { gross: grossReceivable, recordedReimbursements: reimbursements, net: Math.max(0, grossReceivable - reimbursements) }, orphanReferences }));
} finally { await mongoose.disconnect(); }
