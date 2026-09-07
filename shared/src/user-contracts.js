import { z } from "zod";

export const userSchema = z.strictObject({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.enum(["admin", "user"]),
  workspaceId: z.string().min(1),
  displayName: z.string(),
  active: z.boolean(),
  lockedAt: z.iso.datetime().nullable(),
});

export const userListSchema = z.array(userSchema);
