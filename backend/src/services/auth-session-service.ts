import { ApiError } from "../errors.js";
import type { AuthRepository } from "../auth-repository.js";
import { verifyPassword } from "../password.js";
import type { Session } from "../auth.js";

type LoginRepository = Pick<AuthRepository, "findUserByEmail" | "touchLogin">;

export class AuthSessionService {
  static async login(email: string, password: unknown, repository: LoginRepository): Promise<Session> {
    const user = await repository.findUserByEmail(email);
    if (!user || !user.active || user.lockedAt || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, "UNAUTHENTICATED", "Email hoặc mật khẩu không đúng.");
    }
    await repository.touchLogin(user.id);
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspaceId,
      sessionVersion: user.sessionVersion ?? 0,
    };
  }
}
