import { z } from "zod";

export const financeCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().trim().min(1).max(100).optional(),
}).strict();

export const financeCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  parentId: z.string().nullable(),
  system: z.boolean(),
});

export const financeCategoryListSchema = z.array(financeCategorySchema);
