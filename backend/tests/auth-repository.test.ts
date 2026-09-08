import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoAuthRepository } from "../src/auth-repository.js";

const userId = "507f1f77bcf86cd799439011";

test("MongoAuthRepository atomically bumps sessionVersion for security changes", async (t) => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const users = {
    updateOne: async (...args: unknown[]) => {
      calls.push({ method: "updateOne", args });
      return { acknowledged: true, modifiedCount: 1 };
    },
    findOne: async () => ({
      _id: new mongoose.Types.ObjectId(userId), email: "user@example.test", passwordHash: "hash",
      role: "user", workspaceId: "workspace-a", displayName: "User", active: true, lockedAt: null,
      sessionVersion: 2,
    }),
    findOneAndUpdate: async (...args: unknown[]) => {
      calls.push({ method: "findOneAndUpdate", args });
      return {
        _id: new mongoose.Types.ObjectId(userId), email: "user@example.test", passwordHash: "hash",
        role: "admin", workspaceId: "workspace-b", displayName: "User", active: true, lockedAt: null,
        sessionVersion: 3,
      };
    },
  };
  t.mock.method(mongoose.connection, "collection", () => users as never);

  const repository = new MongoAuthRepository();
  await repository.updatePassword(userId, "new-hash");
  assert.deepEqual((calls[0]?.args[1] as { $inc: object }).$inc, { sessionVersion: 1 });

  const updated = await repository.updateUser(userId, { role: "admin", workspaceId: "workspace-b" });
  assert.deepEqual((calls[1]?.args[1] as { $inc: object }).$inc, { sessionVersion: 1 });
  assert.equal(updated?.sessionVersion, 3);
});
