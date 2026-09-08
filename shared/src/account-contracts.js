import { z } from "zod";

export const accountTypeSchema = z.enum(["DEBIT", "CASH", "E_WALLET", "CREDIT"]);
export const realMoneyAccountTypeSchema = z.enum(["DEBIT", "CASH", "E_WALLET"]);
export const accountGroupSchema = z.enum(["REAL_MONEY", "DEBT"]);

const accountName = z.string().trim().min(1).max(120);
const openingBalance = z.number().int().nonnegative();

export const createAccountInputSchema = z.object({
  name: accountName,
  type: accountTypeSchema,
  creditCardId: z.string().trim().min(1).optional(),
  openingBalance: openingBalance.default(0),
}).superRefine((value, context) => {
  if (value.type !== "CREDIT" && value.creditCardId) {
    context.addIssue({ code: "custom", path: ["creditCardId"], message: "Chỉ tài khoản CREDIT mới được liên kết thẻ." });
  }
});

export const createRealMoneyAccountInputSchema = z.object({
  name: accountName,
  type: realMoneyAccountTypeSchema,
  openingBalance: openingBalance.default(0),
});

export const accountSchema = z.object({
  id: z.string().min(1),
  name: accountName,
  type: accountTypeSchema,
  group: accountGroupSchema,
  currency: z.literal("VND"),
  active: z.boolean(),
  creditCardId: z.string().min(1).nullable(),
  openingBalance,
  currentBalance: z.number().int(),
  currentDebt: z.number().int().nonnegative(),
});

export const accountListSchema = z.array(accountSchema);

export const mergeAccountsInputSchema = z.object({
  sourceAccountIds: z.array(z.string().trim().min(1)).min(1).max(20),
  targetAccountId: z.string().trim().min(1).optional(),
  targetName: accountName.optional(),
  targetType: realMoneyAccountTypeSchema.optional(),
  keepTargetAsCash: z.boolean().default(false),
  expectedVersion: z.number().int().nonnegative().optional(),
}).superRefine((value, ctx) => {
  if (!value.targetAccountId && !value.targetName) ctx.addIssue({ code: "custom", path: ["targetAccountId"], message: "Cần targetAccountId hoặc targetName." });
  if (new Set(value.sourceAccountIds).size !== value.sourceAccountIds.length) ctx.addIssue({ code: "custom", path: ["sourceAccountIds"], message: "sourceAccountIds không được trùng." });
});

export const mergeAccountsPreviewSchema = z.object({
  operation: z.literal("merge_accounts"), previewId: z.string(), confirmationToken: z.string(), expiresAt: z.string(),
  sourceAccountIds: z.array(z.string()), targetAccountId: z.string(), transactionCount: z.number().int().nonnegative(),
  before: z.object({ sourceBalance: z.number().int(), targetBalance: z.number().int(), totalBalance: z.number().int() }),
  after: z.object({ targetBalance: z.number().int(), totalBalance: z.number().int() }), warnings: z.array(z.string()),
});
