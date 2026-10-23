import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200),
  role: z.enum(["DEVELOPER", "RESEARCHER", "OWNER"]),
  // Someone else's referral code, entered at signup -- optional, not
  // validated against the DB here (that lookup needs an async query, done
  // in the signup route itself; an unknown code is just silently ignored).
  referralCode: z.string().trim().max(32).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Missing reset token"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const walletConnectSchema = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Not a valid Ethereum address"),
});

export const skillBuySchema = z.object({
  skillId: z.string().min(1),
});

export const skillCollectionCreateSchema = z.object({
  skillSlug: z.string().min(1),
  fileName: z.string().min(1).max(300).optional(),
  durationSec: z.number().int().positive().max(60 * 60).optional(),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024).optional(),
});

export const customSkillCreateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60),
});

export const appCategorySchema = z.enum(["HOME", "SHOP", "OFFICE", "WAREHOUSE", "HOSPITAL"]);

export const appListingCreateSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(60),
  description: z.string().trim().max(500).optional(),
  category: appCategorySchema,
  skillCollectionIds: z.array(z.string().min(1)).min(1, "Pick at least one trained skill"),
});

// No real payment processor behind this -- same off-chain $ ledger as the
// rest of the app (see TokenTransaction in schema.prisma). The cap just
// bounds a single top-up request, not lifetime balance.
export const walletTopupSchema = z.object({
  amountUsd: z.number().int().positive().max(5000),
});

export const rentPlanSchema = z.object({
  termMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]),
});

export const skillSubscribeSchema = z.object({
  months: z.number().int().min(1).max(12).default(1),
});

export const gadgetOrderSchema = z.object({
  recipientName: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  recipientEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  phone: z.string().trim().min(6, "Enter a valid phone number").max(30),
  shippingAddress: z.string().trim().min(10, "Enter a full shipping address").max(500),
});
