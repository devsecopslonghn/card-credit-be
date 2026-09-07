import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { signSession, sessionCookie } from "../src/auth.js";
import { InMemoryNotesRepository } from "../src/notes.js";
import type { NotesRepository } from "../src/notes.js";
import { registerNotesRoutes } from "../src/notes-routes.js";
const secret = "01234567890123456789012345678901";
const cookie = (workspaceId: string, userId = "u1") => sessionCookie(signSession({ userId, email: `${userId}@example.test`, role: "user", workspaceId }, secret));
test("notes require auth, scope by workspace, upsert, and delete blank content", async () => {
  const repository = new InMemoryNotesRepository(); const app = buildApp({ isReady: () => true }, "silent"); const users = { findUserById: async (id: string) => id === "u1" ? { id, email: "u1@example.test", passwordHash: "", role: "user" as const, workspaceId: "a", displayName: "User", active: true, lockedAt: null } : id === "u2" ? { id, email: "u2@example.test", passwordHash: "", role: "user" as const, workspaceId: "b", displayName: "Other", active: true, lockedAt: null } : null }; registerNotesRoutes(app, repository, secret, users);
  assert.equal((await app.inject({ url: "/api/notes" })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/notes", headers: { cookie: cookie("a") }, payload: { date: "2026-07-11", content: " Note " } })).statusCode, 200);
  await app.inject({ method: "POST", url: "/api/notes", headers: { cookie: cookie("a") }, payload: { date: "2026-07-12", content: "Newer" } });
  const limited = await app.inject({ url: "/api/notes?limit=1", headers: { cookie: cookie("a") } });
  assert.deepEqual(limited.json().map((note: { content: string }) => note.content), ["Newer"]);
  assert.deepEqual((await app.inject({ url: "/api/notes", headers: { cookie: cookie("b", "u2") } })).json(), []);
  await app.inject({ method: "POST", url: "/api/notes", headers: { cookie: cookie("a") }, payload: { date: "2026-07-11", content: " " } }); assert.deepEqual((await app.inject({ url: "/api/notes", headers: { cookie: cookie("a") } })).json().map((note: { content: string }) => note.content), ["Newer"]); await app.close();
});

test("notes POST revalidates the browser identity before repository writes", async () => {
  let writes = 0;
  const repository: NotesRepository = {
    list: async () => [],
    upsert: async () => { writes += 1; return { workspaceId: "a", date: "2026-07-11", content: "blocked" }; },
    remove: async () => { writes += 1; },
  };
  const users = {
    findUserById: async () => ({ id: "u1", email: "u1@example.test", passwordHash: "", role: "user" as const, workspaceId: "b", displayName: "Moved", active: true, lockedAt: null }),
  };
  const app = buildApp({ isReady: () => true }, "silent");
  registerNotesRoutes(app, repository, secret, users);
  const response = await app.inject({ method: "POST", url: "/api/notes", headers: { cookie: cookie("a") }, payload: { date: "2026-07-11", content: "blocked" } });
  assert.equal(response.statusCode, 401);
  assert.equal(writes, 0);
  await app.close();
});
