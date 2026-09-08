import { sessionMaxAgeMs } from "./auth.js";

export type BackendConfig = {
  host: string;
  port: number;
  mongodbUri: string;
  authSecret: string;
  logLevel: string;
  shutdownTimeoutMs: number;
  bootstrapToken?: string;
  configuredUsers: Array<Record<string, unknown>>;
  returnResetToken: boolean;
  reminderScanIntervalMs: number;
  reminderClaimTimeoutMs: number;
  mcpHttpToken?: string;
  mcpPreviewSecret?: string;
  mcpWriterMode: "read" | "write";
  mcpOldWriterFenced: boolean;
  sessionMaxAgeMs: number;
};

const required = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const integer = (value: string | undefined, fallback: number, name: string) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a positive integer no greater than 65535`);
  }
  return parsed;
};

const duration = (value: string | undefined, fallback: number, name: string) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 86_400_000) {
    throw new Error(`${name} must be an integer between 1000 and 86400000 milliseconds`);
  }
  return parsed;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): BackendConfig => {
  const authSecret = required(env, "AUTH_SECRET");
  if (authSecret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");

  let configuredUsers: Array<Record<string, unknown>> = [];
  if (env.AUTH_USERS_JSON?.trim()) {
    const parsed = JSON.parse(env.AUTH_USERS_JSON) as unknown;
    if (!Array.isArray(parsed)) throw new Error("AUTH_USERS_JSON must be an array");
    configuredUsers = parsed as Array<Record<string, unknown>>;
  }
  const mcpHttpToken = env.MCP_HTTP_TOKEN?.trim() || undefined;
  const mcpPreviewSecret = env.MCP_PREVIEW_SECRET?.trim() || undefined;
  if (mcpHttpToken && (!mcpPreviewSecret || mcpPreviewSecret.length < 32)) throw new Error("MCP_PREVIEW_SECRET must contain at least 32 characters when MCP is enabled");
  const mcpWriterMode = env.MCP_WRITER_MODE?.trim() || "read";
  if (mcpWriterMode !== "read" && mcpWriterMode !== "write") throw new Error("MCP_WRITER_MODE must be read or write");
  const mcpOldWriterFenced = env.MCP_OLD_WRITER_FENCED?.trim() === "true";
  if (mcpWriterMode === "write" && !mcpOldWriterFenced) throw new Error("MCP_WRITER_MODE=write requires MCP_OLD_WRITER_FENCED=true after the old writer is fenced");
  return {
    host: env.BACKEND_HOST?.trim() || "0.0.0.0",
    port: integer(env.BACKEND_PORT, 3001, "BACKEND_PORT"),
    mongodbUri: required(env, "MONGODB_URI"),
    authSecret,
    logLevel: env.LOG_LEVEL?.trim() || "info",
    shutdownTimeoutMs: integer(env.SHUTDOWN_TIMEOUT_MS, 10000, "SHUTDOWN_TIMEOUT_MS"),
    bootstrapToken: env.AUTH_BOOTSTRAP_TOKEN?.trim() || undefined,
    configuredUsers,
    returnResetToken: env.PASSWORD_RESET_RETURN_TOKEN === "true",
    reminderScanIntervalMs: env.NODE_ENV === "test" ? 0 : integer(env.REMINDER_SCAN_INTERVAL_MS, 60000, "REMINDER_SCAN_INTERVAL_MS"),
    reminderClaimTimeoutMs: duration(env.REMINDER_CLAIM_TIMEOUT_MS, 300000, "REMINDER_CLAIM_TIMEOUT_MS"),
    mcpHttpToken,
    mcpPreviewSecret,
    mcpWriterMode,
    mcpOldWriterFenced,
    sessionMaxAgeMs: sessionMaxAgeMs(env.AUTH_SESSION_MAX_AGE_MS),
  };
};
