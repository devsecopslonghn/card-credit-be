import { z } from "zod";
import { cardPortfolioCardSchema } from "./portfolio-contracts.js";

export const cardDuplicateGroupSchema = z.object({
  fingerprint: z.string().min(1),
  presetId: z.string().min(1),
  normalizedOwner: z.string().min(1),
  reason: z.string().min(1),
  cards: z.array(cardPortfolioCardSchema).min(2),
});

export const cardDuplicateGroupListSchema = z.array(cardDuplicateGroupSchema);
