import { z } from "zod";

export const authSessionSchema = z.strictObject({
  email: z.string().min(1),
  role: z.enum(["admin", "user"]),
  workspaceId: z.string().min(1),
});

export const authSessionListSchema = z.array(authSessionSchema);
