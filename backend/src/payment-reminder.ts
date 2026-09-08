export type ReminderEmail = { to: string; subject: string; text: string; html: string };
export const localParts = (date: Date, timeZone: string) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
const epochDay = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const dateFromEpochDay = (value: number) => new Date(value * 86_400_000).toISOString().slice(0, 10);
export const reminderDueDate = (now: Date, daysBefore: number, timezone: string) => {
  const p = localParts(now, timezone);
  return dateFromEpochDay(epochDay(`${p.year}-${p.month}-${p.day}`) + daysBefore);
};
export const reminderIsDue = (now: Date, dueDate: string, daysBefore: number, timezone: string, sendTime: string) => {
  const p = localParts(now, timezone); const localDate = `${p.year}-${p.month}-${p.day}`;
  return epochDay(dueDate) - epochDay(localDate) === daysBefore && `${p.hour}:${p.minute}` >= sendTime;
};
export const retryAt = (now: Date, attemptCount: number) => new Date(now.getTime() + [60_000, 5 * 60_000, 30 * 60_000][Math.min(attemptCount - 1, 2)]!);
export const composePaymentReminder = (input: { to: string; cardName: string; statementDate: string; dueDate: string; amount: number; daysBefore: number }): ReminderEmail => {
  const amount = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(input.amount);
  const text = `Nhắc thanh toán thẻ ${input.cardName}\nKỳ sao kê: ${input.statementDate}\nHạn thanh toán: ${input.dueDate}\nSố tiền: ${amount}\nCòn ${input.daysBefore} ngày. Vui lòng kiểm tra trạng thái hiện tại trong ứng dụng trước khi thanh toán.`;
  return { to: input.to, subject: `Nhắc thanh toán thẻ - còn ${input.daysBefore} ngày`, text, html: `<p>Nhắc thanh toán thẻ <strong>${input.cardName.replace(/[<>&]/g, "")}</strong></p><p>Kỳ sao kê: ${input.statementDate}<br>Hạn thanh toán: ${input.dueDate}<br>Số tiền: ${amount}<br>Còn ${input.daysBefore} ngày.</p><p>Vui lòng kiểm tra trạng thái hiện tại trong ứng dụng trước khi thanh toán.</p>` };
};
