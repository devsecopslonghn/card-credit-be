import crypto from "node:crypto";
import { ApiError } from "../errors.js";
import type { AuthRepository, AuthUser } from "../auth-repository.js";
import type { MailService } from "../mail-service.js";
import { hashPassword } from "../password.js";
import { normalizeEmail, requirePassword, validEmail } from "./auth-policy.js";

type PasswordResetRepository = Pick<AuthRepository, "findResetToken" | "findUserById" | "updatePassword" | "consumeResetTokens">;
type ForgotPasswordRepository = Pick<AuthRepository, "findUserByEmail" | "createResetToken">;
type ForgotPasswordOptions = {
  repository: ForgotPasswordRepository;
  resetBaseUrl: string;
  returnResetToken?: boolean;
  mail?: Pick<MailService, "sendPasswordResetEmail">;
};
export const hashResetToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export class ForgotPasswordService {
  static async request(rawEmail: unknown, options: ForgotPasswordOptions) {
    const email = normalizeEmail(rawEmail);
    if (email && !validEmail(email)) throw new ApiError(400, "INVALID_EMAIL", "Email không hợp lệ.", { email: "Vui lòng nhập email hợp lệ." });
    const user = email ? await options.repository.findUserByEmail(email) : null;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    let rawToken: string | null = null;
    if (user?.active && !user.lockedAt) {
      rawToken = crypto.randomBytes(32).toString("base64url");
      await options.repository.createResetToken({ tokenHash: hashResetToken(rawToken), userId: user.id, email: user.email, expiresAt, usedAt: null });
    }
    const resetLink = rawToken ? `${options.resetBaseUrl}/forgot-password?token=${rawToken}` : null;
    let delivered = false;
    if (user && resetLink && options.mail?.sendPasswordResetEmail) {
      try { await options.mail.sendPasswordResetEmail({ to: user.email, resetLink, expiresAt }); delivered = true; } catch { delivered = false; }
    }
    const canExposeResetLink = options.returnResetToken && (!options.mail || delivered);
    return { email, delivered, resetLink: canExposeResetLink ? resetLink : null };
  }
}

export class PasswordResetService {
  static async complete(rawToken: string, password: unknown, repository: PasswordResetRepository): Promise<AuthUser> {
    const normalizedPassword = requirePassword(password);
    if (!rawToken) throw new ApiError(400, "INVALID_TOKEN", "Token đặt lại mật khẩu không hợp lệ.");
    const token = await repository.findResetToken(hashResetToken(rawToken), new Date());
    if (!token) throw new ApiError(400, "INVALID_TOKEN", "Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.");
    const user = await repository.findUserById(token.userId);
    if (!user?.active || user.lockedAt) throw new ApiError(400, "INVALID_TOKEN", "Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.");
    await repository.updatePassword(user.id, await hashPassword(normalizedPassword));
    await repository.consumeResetTokens(user.id, new Date());
    return user;
  }
}
