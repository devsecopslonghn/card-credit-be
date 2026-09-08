import { z } from "zod";

const isoDateTime = z.iso.datetime();
const subscriptionPath = z.string().regex(/^\/api\/calendar-subscriptions\/feed\/[A-Za-z0-9_-]{43}\.ics$/, "Invalid subscription path");

export const calendarSubscriptionSchema = z.strictObject({
  id: z.string().min(1),
  deviceLabel: z.string().nullable(),
  createdAt: isoDateTime,
  lastAccessedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
});

export const calendarSubscriptionListSchema = z.array(calendarSubscriptionSchema);
export const calendarSubscriptionCreateSchema = z.strictObject({
  ...calendarSubscriptionSchema.shape,
  subscriptionPath,
});
