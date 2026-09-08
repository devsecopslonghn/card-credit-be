import { ApiError } from "../errors.js";
import { WorkspaceModel } from "../models/workspace.js";
import type { AuthRepository } from "../auth-repository.js";
import type { ServiceContext } from "./types/service-context.js";

type Data = Record<string, unknown>;

export type WorkspaceRepository = {
  findOne(filter: Data): Promise<unknown | null>;
  updateOne(filter: Data, update: Data, options: Data): Promise<unknown>;
};

const workspaceRepository: WorkspaceRepository = {
  findOne: async (filter) => WorkspaceModel.findOne(filter),
  updateOne: async (filter, update, options) => WorkspaceModel.updateOne(filter, update, options),
};

const valueOf = (workspace: unknown, key: string) => {
  if (!workspace || typeof workspace !== "object") return undefined;
  const document = workspace as { get?: (field: string) => unknown } & Data;
  return typeof document.get === "function" ? document.get(key) : document[key];
};

export class WorkspaceService {
  static async ownerStatus(ctx: ServiceContext, workspaces: WorkspaceRepository = workspaceRepository) {
    const workspace = await workspaces.findOne({ workspaceId: ctx.workspaceId });
    return { configured: Boolean(valueOf(workspace, "ownerUserId")) };
  }

  static async setOwner(
    ctx: ServiceContext,
    ownerUserId: unknown,
    users: Pick<AuthRepository, "findUserById">,
    workspaces: WorkspaceRepository = workspaceRepository,
  ) {
    if (ctx.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
    if (typeof ownerUserId !== "string") throw new ApiError(400, "INVALID_WORKSPACE_OWNER", "Owner workspace không hợp lệ.");
    const user = await users.findUserById(ownerUserId);
    if (!user || user.workspaceId !== ctx.workspaceId || !user.active || user.lockedAt) {
      throw new ApiError(400, "INVALID_WORKSPACE_OWNER", "Owner workspace không hợp lệ.");
    }
    await workspaces.updateOne(
      { workspaceId: ctx.workspaceId },
      { $set: { ownerUserId, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    return { configured: true };
  }
}
