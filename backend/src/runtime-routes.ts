import type { FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerUserRoutes } from "./user-routes.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerCalendarSubscriptionRoutes } from "./calendar-subscription-routes.js";
import { registerCardRoutes } from "./card-routes.js";
import { registerAccountRoutes } from "./account-routes.js";
import { registerFinancialTransactionRoutes } from "./financial-transaction-routes.js";
import { registerFinancialReportRoutes } from "./financial-report-routes.js";
import { registerFinanceRoutes } from "./finance-routes.js";
import { registerRecurringExpenseRoutes } from "./recurring-expense-routes.js";
import { registerMonthlyCardCashbackRoutes } from "./monthly-card-cashback-routes.js";
import { registerNotificationRoutes } from "./notification-routes.js";
import { registerFeeCenterRoutes } from "./fee-center-routes.js";
import { registerCashFlowRoutes } from "./cash-flow-routes.js";
import { registerTransactionRoutes } from "./transaction-routes.js";
import { registerNotesRoutes } from "./notes-routes.js";
import { registerMasterdataRoutes } from "./masterdata-routes.js";
import type { AuthRepository } from "./auth-repository.js";
import type { CatalogRepository } from "./catalog.js";
import type { AuthOptions } from "./auth-routes.js";
import type { NotesRepository } from "./notes.js";
import type { MasterdataRepository } from "./masterdata.js";
import type { MailService } from "./mail-service.js";

export type RuntimeRouteDependencies = {
  app: FastifyInstance;
  auth: AuthOptions;
  authRepository: AuthRepository;
  catalogRepository: CatalogRepository;
  notesRepository: NotesRepository;
  masterdataRepository: MasterdataRepository;
  mailService: MailService;
};

/** Registers the production REST composition without opening a database. */
export const registerRuntimeRoutes = ({ app, auth, authRepository, catalogRepository, notesRepository, masterdataRepository, mailService }: RuntimeRouteDependencies) => {
  registerAuthRoutes(app, { ...auth, mail: auth.mail ?? mailService });
  registerUserRoutes(app, authRepository, auth.secret);
  registerWorkspaceRoutes(app, authRepository, auth.secret);
  registerCalendarSubscriptionRoutes(app, authRepository, auth.secret);
  registerCardRoutes(app, auth.secret, authRepository, catalogRepository);
  registerAccountRoutes(app, auth.secret, authRepository);
  registerFinancialTransactionRoutes(app, auth.secret, authRepository);
  registerFinancialReportRoutes(app, auth.secret, authRepository);
  registerFinanceRoutes(app, auth.secret, authRepository);
  registerRecurringExpenseRoutes(app, auth.secret, authRepository);
  registerMonthlyCardCashbackRoutes(app, auth.secret, authRepository);
  registerNotificationRoutes(app, auth.secret, authRepository);
  registerFeeCenterRoutes(app, auth.secret, authRepository);
  registerCashFlowRoutes(app, auth.secret, authRepository);
  registerTransactionRoutes(app, auth.secret, { users: authRepository, mail: mailService });
  registerNotesRoutes(app, notesRepository, auth.secret, authRepository);
  registerMasterdataRoutes(app, masterdataRepository, auth.secret, authRepository);
};
