import type { AuthRepository, AuthUser } from "../auth-repository.js";
import { ApiError } from "../errors.js";
import { hashPassword } from "../password.js";
import { normalizeEmail, requirePassword, validEmail } from "./auth-policy.js";

type BootstrapRepository = Pick<AuthRepository, "upsertUser">;

export class AuthBootstrapService {
  static async run(configuredUsers: Array<Record<string, unknown>>, repository: BootstrapRepository): Promise<AuthUser[]> {
    if (!configuredUsers.length) throw new ApiError(400, "NO_BOOTSTRAP_USERS", "AUTH_USERS_JSON chưa có user để bootstrap.");
    const results: AuthUser[] = [];
    for (const item of configuredUsers) {
      const email = normalizeEmail(item.email);
      if (!validEmail(email)) throw new ApiError(400, "INVALID_EMAIL", "Email không hợp lệ.");
      const passwordHash = typeof item.passwordHash === "string" ? item.passwordHash : await hashPassword(requirePassword(item.password));
      const user = await repository.upsertUser({ email, passwordHash, role: item.role === "admin" ? "admin" : "user", workspaceId: String(item.workspaceId), displayName: typeof item.displayName === "string" ? item.displayName.trim() : email.split("@")[0]!, active: item.active !== false, lockedAt: item.lockedAt ? new Date(String(item.lockedAt)) : null });
      results.push(user);
    }
    return results;
  }
}
