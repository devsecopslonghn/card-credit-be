import { ApiError } from "../errors.js";
import { MailDeliveryError, MailUnavailableError, maskEmail, type MailService } from "../mail-service.js";
import { composeStatementCalendarEmail } from "../statement-calendar-email.js";
import { projectStatementCalendar, serializeStatementCalendar } from "../statement-calendar.js";
import type { ServiceContext } from "./types/service-context.js";
import { CardQueryService } from "./card-query-service.js";
import { StatementQueryService } from "./statement-query-service.js";
import { validEmail } from "./auth-policy.js";

type CalendarMail = Pick<MailService, "sendStatementCalendarEmail">;

export class StatementCalendarEmailService {
  static async send(ctx: ServiceContext, actorEmail: string, cardId: string, statementId: string, mail: CalendarMail) {
    const recipient = actorEmail.trim().toLowerCase();
    if (!validEmail(recipient)) throw new ApiError(400, "ACCOUNT_EMAIL_UNAVAILABLE", "Email tài khoản không khả dụng.");
    const card = await CardQueryService.get(ctx, cardId);
    const statement = await StatementQueryService.get(ctx, cardId, statementId);
    const projection = {
      identity: `${ctx.workspaceId}:${cardId}:${statementId}`,
      displayName: card.displayName ?? "Thẻ tín dụng",
      providerName: card.providerName ?? "",
      owner: card.owner,
      periodStartDate: statement.periodStartDate,
      periodEndDate: statement.periodEndDate,
      statementDate: statement.statementDate,
      paymentDueDate: statement.paymentDueDate,
      totalAmountDue: statement.summary.outstandingAmount,
      effectivePaymentStatus: statement.effectivePaymentStatus,
    };
    const calendarContent = serializeStatementCalendar(projectStatementCalendar(projection));
    try {
      await mail.sendStatementCalendarEmail(composeStatementCalendarEmail({ ...projection, recipient, calendarContent }));
    } catch (error) {
      if (error instanceof MailUnavailableError) throw new ApiError(503, "MAIL_UNAVAILABLE", "Tính năng gửi lịch hiện chưa khả dụng.");
      if (error instanceof MailDeliveryError) throw new ApiError(502, "MAIL_DELIVERY_FAILED", "Không thể gửi file lịch. Vui lòng thử lại sau.");
      throw error;
    }
    return { sent: true as const, recipient: maskEmail(recipient) };
  }
}
