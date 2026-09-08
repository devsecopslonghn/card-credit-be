import mongoose from "mongoose";
import { loadConfig } from "../src/config.js";
import { AccountModel } from "../src/models/account.js";
import { FinancialTransactionModel } from "../src/models/financial-transaction.js";
import { CardStatementModel } from "../src/models/card-statement.js";
import { inspectFinanceRepair, reconcileFinanceMonth } from "../src/finance-repair.js";

const workspaceId = process.env.REPAIR_WORKSPACE_ID?.trim();
if (!workspaceId) throw new Error("REPAIR_WORKSPACE_ID is required; this command is read-only and has no default workspace.");
const from = process.env.REPAIR_FROM?.trim();
const to = process.env.REPAIR_TO?.trim();
const config = loadConfig();
await mongoose.connect(config.mongodbUri);
try {
  const [accounts, transactions, statements] = await Promise.all([
    AccountModel.find({ workspaceId }).lean(),
    FinancialTransactionModel.find({ workspaceId }).lean(),
    CardStatementModel.find({ workspaceId }).lean(),
  ]);
  const report = inspectFinanceRepair(accounts, transactions, statements);
  const reconciliation = from && to ? { beforeRepair: reconcileFinanceMonth(accounts, transactions, statements, { from, to }), afterRepair: null, note: "afterRepair remains null until a separately reviewed migration preview is confirmed; no projection or write is performed." } : null;
  console.log(JSON.stringify({ mode: "DRY_RUN_READ_ONLY", workspaceId, report, reconciliation, rollback: "No writes performed; apply only through a separately reviewed preview/confirm migration." }, null, 2));
} finally { await mongoose.disconnect(); }
