import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { DatabaseLifecycle } from "./database.js";
import { MongoCatalogRepository } from "./mongo-catalog-repository.js";
import { writeAuthAudit, writeCatalogAudit } from "./catalog-audit.js";
import { MongoAuthRepository } from "./auth-repository.js";
import { MongoNotesRepository } from "./notes.js";
import { MongoMasterdataRepository } from "./masterdata.js";
import { SmtpMailService } from "./mail-service.js";
import { ReminderScheduler } from "./reminder-scheduler.js";
import { registerMcpHttp } from "./mcp/http.js";
import { fixedMcpContext } from "./mcp/context.js";
import { registerApiDocs } from "./api-docs.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { createPreviewTokenCodec } from "./mcp/preview.js";

const config = loadConfig();
const database = new DatabaseLifecycle();
const catalogRepository = new MongoCatalogRepository();
const authRepository = new MongoAuthRepository();
const app = buildApp(database, config.logLevel, catalogRepository, config.authSecret, writeCatalogAudit, authRepository);
if (config.mcpHttpToken) registerMcpHttp(app, fixedMcpContext(), config.mcpHttpToken, authRepository, createPreviewTokenCodec({ secret: config.mcpPreviewSecret ?? "" }), config.mcpWriterMode);
if (process.env.API_DOCS_ENABLED !== "false") await registerApiDocs(app, config.mcpWriterMode);
const mailService = new SmtpMailService();
const reminderScheduler = new ReminderScheduler(authRepository, mailService, config.reminderScanIntervalMs, config.reminderClaimTimeoutMs, app.log);
registerRuntimeRoutes({
  app,
  auth: { repository: authRepository, secret: config.authSecret, bootstrapToken: config.bootstrapToken, configuredUsers: config.configuredUsers, returnResetToken: config.returnResetToken, sessionMaxAgeMs: config.sessionMaxAgeMs, audit: writeAuthAudit, mail: mailService },
  authRepository,
  catalogRepository,
  notesRepository: new MongoNotesRepository(),
  masterdataRepository: new MongoMasterdataRepository(),
  mailService,
});
let stopping = false;

const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  app.log.info({ event: "SHUTDOWN_STARTED", signal });
  const timeout = setTimeout(() => process.exit(1), config.shutdownTimeoutMs).unref();
  try {
    reminderScheduler.stop();
    await app.close();
    await database.disconnect();
    clearTimeout(timeout);
    app.log.info({ event: "SHUTDOWN_COMPLETE" });
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error, event: "SHUTDOWN_FAILED" });
    process.exit(1);
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await database.connect(config.mongodbUri);
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ event: "SERVER_LISTENING", host: config.host, port: config.port });
  reminderScheduler.start();
} catch (error) {
  app.log.fatal({ err: error, event: "STARTUP_FAILED" });
  await database.disconnect();
  process.exit(1);
}
