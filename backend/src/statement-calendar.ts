import crypto from "node:crypto";

export type StatementCalendarEvent = {
  key: string;
  type: "payment-due";
  date: string;
  timezone: string;
  title: string;
  description: string;
};

export type StatementCalendarInput = {
  identity: string;
  displayName: string;
  providerName: string;
  owner: string;
  periodStartDate: string;
  periodEndDate: string;
  statementDate: string;
  paymentDueDate: string;
  totalAmountDue: number;
  effectivePaymentStatus: string;
  timezone?: string;
};

const statusLabel: Record<string, string> = {
  OPEN: "Đang mở",
  STATEMENT_CLOSED: "Đã chốt sao kê",
  PAID: "Đã thanh toán",
  OVERDUE: "Quá hạn",
};

export const projectStatementCalendar = (input: StatementCalendarInput): StatementCalendarEvent[] => {
  const common = [
    `Thẻ: ${input.displayName}`,
    `Ngân hàng: ${input.providerName}`,
    `Chủ thẻ: ${input.owner}`,
    `Kỳ sao kê: ${input.periodStartDate} – ${input.periodEndDate}`,
    `Tổng phải trả: ${Math.round(input.totalAmountDue).toLocaleString("vi-VN")} VND`,
    `Trạng thái: ${statusLabel[input.effectivePaymentStatus] ?? input.effectivePaymentStatus}`,
    `Ngày chốt: ${input.statementDate}`,
    `Hạn thanh toán: ${input.paymentDueDate}`,
  ].join("\n");
  const key = (type: StatementCalendarEvent["type"]) =>
    crypto.createHash("sha256").update(`${input.identity}:${type}`).digest("hex");
  let timezone = "Asia/Ho_Chi_Minh";
  if (input.timezone) try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); timezone = input.timezone; } catch { timezone = "Asia/Ho_Chi_Minh"; }
  return [{ key: key("payment-due"), type: "payment-due", date: input.paymentDueDate, timezone, title: `Hạn thanh toán – ${input.displayName}`, description: common }];
};

const escapeText = (value: string) => value
  .replaceAll("\\", "\\\\")
  .replaceAll("\r\n", "\\n")
  .replaceAll("\n", "\\n")
  .replaceAll("\r", "\\n")
  .replaceAll(",", "\\,")
  .replaceAll(";", "\\;");

const utf8Length = (value: string) => Buffer.byteLength(value, "utf8");
const foldLine = (line: string) => {
  if (utf8Length(line) <= 75) return line;
  const lines: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = lines.length === 0 ? 75 : 74;
    if (utf8Length(current + char) > limit) {
      lines.push(current);
      current = char;
    } else current += char;
  }
  lines.push(current);
  return lines.join("\r\n ");
};

const compactDate = (value: string) => value.replaceAll("-", "");
const offsetDate = (value: string, days: number) => {
  const [year, month, day] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, "0")}${String(next.getUTCDate()).padStart(2, "0")}`;
};
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export const serializeStatementCalendar = (events: StatementCalendarEvent[], generatedAt = new Date()) => {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Card Credit//Statement Calendar//VI", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const event of events) lines.push(
    "BEGIN:VEVENT",
    `UID:${event.key}@card-credit`,
    `DTSTAMP:${stamp(generatedAt)}`,
    `DTSTART;TZID=${event.timezone}:${offsetDate(event.date, -3)}T000000`,
    `DTEND;TZID=${event.timezone}:${compactDate(event.date)}T170000`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER;RELATED=START:PT0S",
    `DESCRIPTION:${escapeText(`Còn 3 ngày đến hạn – ${event.title}`)}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER;RELATED=END:-PT8H",
    `DESCRIPTION:${escapeText(`Hạn thanh toán lúc 17:00 hôm nay – ${event.title}`)}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER;RELATED=END:-PT2H",
    `DESCRIPTION:${escapeText(`Còn 2 giờ đến hạn – ${event.title}`)}`,
    "END:VALARM",
    "END:VEVENT",
  );
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
};
