import { z } from "zod";

export const masterBankSchema = z.strictObject({
  _id: z.string().min(1),
  shortname: z.string(),
  name: z.string(),
  fullname: z.string(),
  logo: z.string(),
});

export const masterBankListSchema = z.array(masterBankSchema);

export const masterCardTypeSchema = z.strictObject({
  _id: z.string().min(1),
  name: z.string(),
  logo: z.string(),
});

export const masterCardTypeListSchema = z.array(masterCardTypeSchema);
