import { ApiError } from "../errors.js";
import type { AuthRepository } from "../auth-repository.js";
import type { ServiceContext } from "./types/service-context.js";
import { normalizeDisplayName } from "./user-profile-policy.js";

type ProfileUpdateBody = Record<string, unknown>;

export class ProfileService {
  static async get(context: ServiceContext, users: Pick<AuthRepository, "findUserById">) {
    const user = await users.findUserById(context.userId);
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng.");
    return user;
  }

  static async update(
    context: ServiceContext,
    body: ProfileUpdateBody,
    users: Pick<AuthRepository, "updateUser">,
  ) {
    const forbidden = ["role", "workspaceId", "email", "active", "lockedAt"].filter((field) => field in body);
    if (forbidden.length) {
      throw new ApiError(403, "FORBIDDEN_PROFILE_FIELD", "Bạn không có quyền cập nhật field này.", {
        fields: forbidden.join(", "),
      });
    }
    if (!("displayName" in body)) {
      throw new ApiError(400, "INVALID_REQUEST", "Không có field hồ sơ hợp lệ để cập nhật.");
    }
    const user = await users.updateUser(context.userId, { displayName: normalizeDisplayName(body.displayName) });
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng.");
    return user;
  }
}
