import { z } from "zod";
import { isoDateSchema } from "./date-contracts.js";

export const catalogNetworkSchema = z.enum(["Visa", "Mastercard", "JCB", "American Express", "UnionPay", "Napas"]);
export const catalogThemeSchema = z.object({ background: z.string().min(1), accent: z.string().min(1) });
export const catalogProductSchema = z.object({
  presetId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  providerCode: z.string().regex(/^[A-Z0-9]+$/),
  providerName: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  network: catalogNetworkSchema,
  segment: z.string().trim(),
  annualFee: z.number().nonnegative().nullable(),
  targetSpendForWaiver: z.number().nonnegative().nullable(),
  imageUrl: z.string().nullable(),
  benefits: z.array(z.string()),
  sourceUrl: z.string(),
  sourceCheckedAt: isoDateSchema,
  active: z.boolean(),
  sortOrder: z.number().finite(),
  theme: catalogThemeSchema,
});
export const catalogProviderSchema = z.object({
  providerCode: z.string().regex(/^[A-Z0-9]+$/),
  providerName: z.string().trim().min(1),
  products: z.array(catalogProductSchema),
});
export const catalogProductListSchema = z.array(catalogProductSchema);
export const catalogProviderListSchema = z.array(catalogProviderSchema);
