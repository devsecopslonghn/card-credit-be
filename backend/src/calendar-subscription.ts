import crypto from "node:crypto";
import type { StatementCalendarEvent, StatementCalendarInput } from "./statement-calendar.js";
import { projectStatementCalendar, serializeStatementCalendar } from "./statement-calendar.js";

export const createSubscriptionToken = () => crypto.randomBytes(32).toString("base64url");
export const hashSubscriptionToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const validSubscriptionToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
export const normalizeDeviceLabel = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("INVALID_DEVICE_LABEL");
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80 || /[\r\n]/.test(value)) throw new Error("INVALID_DEVICE_LABEL");
  return label;
};
export const serializePaymentDueFeed = (inputs: StatementCalendarInput[], generatedAt = new Date()) => {
  const events: StatementCalendarEvent[] = inputs.flatMap(projectStatementCalendar);
  return serializeStatementCalendar(events, generatedAt);
};
