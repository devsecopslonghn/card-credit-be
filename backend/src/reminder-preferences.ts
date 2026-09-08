import { ApiError } from "./errors.js";

export const DEFAULT_REMINDER_PREFERENCES = { reminderEnabled: false, reminderDaysBefore: [7, 3, 1], reminderTimezone: "Asia/Ho_Chi_Minh", reminderTime: "08:00" } as const;

export const validTimezone = (value: string) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
};

export const normalizeReminderPreferences = (body: Record<string, unknown>) => {
  const result: Record<string, unknown> = {};
  if ("reminderEnabled" in body) {
    if (typeof body.reminderEnabled !== "boolean") throw new ApiError(400, "INVALID_REMINDER_PREFERENCES", "Cấu hình nhắc thanh toán không hợp lệ.");
    result.reminderEnabled = body.reminderEnabled;
  }
  if ("reminderDaysBefore" in body) {
    if (!Array.isArray(body.reminderDaysBefore) || body.reminderDaysBefore.length === 0 || body.reminderDaysBefore.length > 10 || body.reminderDaysBefore.some((v) => !Number.isInteger(v) || Number(v) < 0 || Number(v) > 60)) throw new ApiError(400, "INVALID_REMINDER_PREFERENCES", "Các mốc nhắc phải là số nguyên từ 0 đến 60 ngày.");
    result.reminderDaysBefore = [...new Set(body.reminderDaysBefore as number[])].sort((a, b) => b - a);
  }
  if ("reminderTimezone" in body) {
    if (typeof body.reminderTimezone !== "string" || !validTimezone(body.reminderTimezone)) throw new ApiError(400, "INVALID_REMINDER_PREFERENCES", "Timezone không hợp lệ.");
    result.reminderTimezone = body.reminderTimezone;
  }
  if ("reminderTime" in body) {
    if (typeof body.reminderTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.reminderTime)) throw new ApiError(400, "INVALID_REMINDER_PREFERENCES", "Giờ nhắc phải theo định dạng HH:mm.");
    result.reminderTime = body.reminderTime;
  }
  return result;
};
