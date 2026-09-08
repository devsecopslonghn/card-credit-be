import type { FastifyInstance } from "fastify";
import { browserServiceContext } from "./context.js";
import type { AuthRepository } from "./auth-repository.js";
import type { NotesRepository } from "./notes.js";
import { NotesService } from "./services/notes-service.js";

export const registerNotesRoutes = (app: FastifyInstance, repository: NotesRepository, secret: string, users: Pick<AuthRepository, "findUserById">) => {
  app.get<{ Querystring: { limit?: string } }>("/api/notes", async (request) => NotesService.list(await browserServiceContext(request, secret, users), request.query.limit, repository));
  app.post<{ Body: { date?: unknown; content?: unknown } }>("/api/notes", async (request) => {
    const context = await browserServiceContext(request, secret, users);
    return NotesService.save(context, request.body ?? {}, repository);
  });
};
