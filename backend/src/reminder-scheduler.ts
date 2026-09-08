import mongoose from "mongoose";
import type { AuthRepository } from "./auth-repository.js";
import { jobServiceContext } from "./context.js";
import type { MailService } from "./mail-service.js";
import { CreditCardModel } from "./models/credit-card.js";
import { ReminderDeliveryModel } from "./models/reminder-delivery.js";
import { WorkspaceModel } from "./models/workspace.js";
import { composePaymentReminder, reminderDueDate, reminderIsDue, retryAt } from "./payment-reminder.js";
import { StatementQueryService } from "./services/statement-query-service.js";
import type { StatementDto } from "@card-credit/contracts";

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export class ReminderScheduler {
  private timer?: NodeJS.Timeout; private running = false;
  constructor(private users: AuthRepository, private mail: MailService & { sendPaymentReminder: NonNullable<MailService["sendPaymentReminder"]> }, private intervalMs: number, private claimTimeoutMs: number, private log: { error(v: unknown): void; info(v: unknown): void }, private now = () => new Date()) {}
  start() { if (this.timer || this.intervalMs <= 0) return; this.timer = setInterval(() => void this.safeScan(), this.intervalMs).unref(); void this.safeScan(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async safeScan() { if (this.running) return; this.running = true; try { await this.scan(); } catch { this.log.error({ event: "REMINDER_SCAN_FAILED" }); } finally { this.running = false; } }
  async scan() {
    const now = this.now();
    const cards = (await CreditCardModel.find({ reminderEnabled: true, active: { $ne: false } })).map((card) => card.toObject() as Record<string, unknown>);
    if (!cards.length) return;
    const cardById = new Map(cards.map((card) => [String(card._id), card]));
    const workspaceIds = [...new Set(cards.map((card) => String(card.workspaceId ?? "")).filter(Boolean))];
    const dueDates = [...new Set(cards.flatMap((card) => (card.reminderDaysBefore as number[] ?? [7, 3, 1]).map((days) => reminderDueDate(now, days, String(card.reminderTimezone ?? "Asia/Ho_Chi_Minh")))))];
    // The scheduler remains a trusted job adapter; statement/date/amount semantics
    // come from the same canonical query service as REST, MCP and calendar reads.
    const statements = (await Promise.all(workspaceIds.map(async (workspaceId) => {
      const context = jobServiceContext({ userId: "scheduler", workspaceId, role: "admin" }, `reminder:${now.toISOString()}`);
      const cardIds = cards.filter((card) => String(card.workspaceId ?? "") === workspaceId).map((card) => String(card._id));
      return StatementQueryService.listForCardIds(context, cardIds, { unpaidOnly: true, paymentDueDates: dueDates, order: "paymentDueDate" });
    }))).flat();
    const candidates = statements.flatMap((statement) => {
      const card = cardById.get(statement.cardId);
      if (!card) return [];
      return (card.reminderDaysBefore as number[] ?? [7, 3, 1])
        .filter((days) => reminderIsDue(now, statement.paymentDueDate, days, String(card.reminderTimezone ?? "Asia/Ho_Chi_Minh"), String(card.reminderTime ?? "08:00")))
        .map((days) => ({ card, statement, days, workspaceId: String(card.workspaceId), cardId: String(card._id) }));
    });
    if (!candidates.length) return;
    const fallbackWorkspaceIds = [...new Set(candidates.filter(({ card }) => typeof card.userId !== "string" || !card.userId).map(({ workspaceId }) => workspaceId))];
    const workspaces = fallbackWorkspaceIds.length ? await WorkspaceModel.find({ workspaceId: { $in: fallbackWorkspaceIds } }) : [];
    const workspaceOwnerById = new Map(workspaces.map((workspace) => [String(workspace.get("workspaceId")), String(workspace.get("ownerUserId") ?? "")]));
    const userById = new Map<string, ReturnType<AuthRepository["findUserById"]>>();
    for (const candidate of candidates) {
      const ownerId = typeof candidate.card.userId === "string" && candidate.card.userId
        ? candidate.card.userId
        : workspaceOwnerById.get(candidate.workspaceId) ?? "";
      if (ownerId && mongoose.isValidObjectId(ownerId) && !userById.has(ownerId)) userById.set(ownerId, this.users.findUserById(ownerId));
      await this.deliver({ ...candidate, user: ownerId ? await userById.get(ownerId) ?? null : null, amount: candidate.statement.summary.outstandingAmount, now });
    }
  }
  private async deliver(x: { now: Date; workspaceId: string; cardId: string; card: Record<string, unknown>; statement: StatementDto; days: number; user: Awaited<ReturnType<AuthRepository["findUserById"]>>; amount: number }) {
    let delivery; const expiredBefore = new Date(x.now.getTime() - this.claimTimeoutMs);
    const claimable = { workspaceId: x.workspaceId, statementId: x.statement.id, daysBefore: x.days, $and: [{ $or: [{ attemptCount: { $exists: false } }, { attemptCount: { $lt: 3 } }] }, { $or: [{ status: { $in: ["PENDING", "FAILED"] }, nextAttemptAt: null }, { status: "FAILED", nextAttemptAt: { $lte: x.now } }, { status: "CLAIMED", claimedAt: { $lte: expiredBefore } }, { status: { $exists: false } }] }] };
    try { delivery = await ReminderDeliveryModel.findOneAndUpdate(claimable, { $setOnInsert: { cardId: x.card._id }, $set: { status: "CLAIMED", claimedAt: x.now, nextAttemptAt: null, failureCode: null }, $inc: { attemptCount: 1 } }, { upsert: true, returnDocument: "after" }); } catch (e) { if ((e as { code?: number }).code === 11000) return; throw e; }
    if (!delivery) return; const attempts = Number(delivery.get("attemptCount"));
    if (!x.user || x.user.workspaceId !== x.workspaceId || !x.user.active || x.user.lockedAt || !emailOk(x.user.email)) { await ReminderDeliveryModel.updateOne({ _id: delivery._id }, { $set: { status: "SKIPPED", failureCode: "RECIPIENT_UNAVAILABLE" } }); return; }
    try { await this.mail.sendPaymentReminder(composePaymentReminder({ to: x.user.email.toLowerCase(), cardName: String(x.card.displayName ?? x.card.name ?? "Thẻ tín dụng"), statementDate: x.statement.statementDate, dueDate: x.statement.paymentDueDate, amount: x.amount, daysBefore: x.days })); await ReminderDeliveryModel.updateOne({ _id: delivery._id }, { $set: { status: "SENT", sentAt: x.now, failureCode: null } }); this.log.info({ event: "PAYMENT_REMINDER_SENT", deliveryId: String(delivery._id) }); }
    catch { await ReminderDeliveryModel.updateOne({ _id: delivery._id }, { $set: attempts >= 3 ? { status: "FAILED", failureCode: "SMTP_SUBMISSION_FAILED", nextAttemptAt: null } : { status: "FAILED", failureCode: "SMTP_SUBMISSION_FAILED", nextAttemptAt: retryAt(x.now, attempts) } }); }
  }
}
