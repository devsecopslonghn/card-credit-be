import type { StatementCalendarInput } from "./statement-calendar.js";

export type StatementCalendarEmailInput = StatementCalendarInput & {
  recipient: string;
  calendarContent: string;
};

export type ComposedEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachment: { filename: string; content: string; contentType: string };
};

const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const html = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const slug = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "the";

export const composeStatementCalendarEmail = (input: StatementCalendarEmailInput): ComposedEmail => {
  const name = cleanHeader(input.displayName);
  const period = `${input.periodStartDate} – ${input.periodEndDate}`;
  const amount = `${Math.round(input.totalAmountDue).toLocaleString("vi-VN")} VND`;
  const paragraphs = [
    `Thẻ: ${name}`,
    `Kỳ sao kê: ${period}`,
    `Ngày chốt sao kê: ${input.statementDate}`,
    `Hạn thanh toán: ${input.paymentDueDate}`,
    `Tổng phải trả: ${amount}`,
    "File .ics đính kèm chỉ chứa lịch hạn thanh toán và có thể được nhập vào Apple Calendar, Google Calendar, Outlook hoặc ứng dụng lịch tương thích.",
    "Đây là lần nhập một lần, không phải đồng bộ liên tục.",
    "Vui lòng kiểm tra số tiền và trạng thái thanh toán hiện tại trong ứng dụng Card Credit.",
  ];
  return {
    to: input.recipient,
    subject: `Lịch hạn thanh toán – ${name}`,
    text: paragraphs.join("\n\n"),
    html: paragraphs.map((item) => `<p>${html(item)}</p>`).join(""),
    attachment: {
      filename: `lich-han-thanh-toan-${slug(name)}-${input.paymentDueDate.slice(0, 7)}.ics`,
      content: input.calendarContent,
      contentType: "text/calendar; charset=utf-8; method=PUBLISH",
    },
  };
};
