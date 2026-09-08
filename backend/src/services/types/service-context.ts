export type ServiceChannel = "browser" | "mcp" | "job";
export type ServiceRole = "admin" | "user";

export type ServiceContext = {
  workspaceId: string;
  userId: string;
  role: ServiceRole;
  channel: ServiceChannel;
  correlationId: string;
  sessionVersion?: number;
};
