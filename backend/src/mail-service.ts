import nodemailer from "nodemailer";
import type { ComposedEmail } from "./statement-calendar-email.js";
import type { ReminderEmail } from "./payment-reminder.js";

export type PasswordResetEmail = { to: string; resetLink: string; expiresAt: Date };

export interface MailService {
  sendStatementCalendarEmail(email: ComposedEmail): Promise<void>;
  sendPaymentReminder?(email: ReminderEmail): Promise<void>;
  sendPasswordResetEmail?(email: PasswordResetEmail): Promise<void>;
}

export class MailUnavailableError extends Error {}
export class MailDeliveryError extends Error {}

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

const unavailable = () => new MailUnavailableError("SMTP configuration is unavailable");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
const validHost = (value: string) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
const validAddress = (value: string) => {
  const match = value.match(/^(?:[^<>\r\n]+\s*)?<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>$/) ?? value.match(/^([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/);
  return Boolean(match);
};
const parsePort = (value: string) => {
  if (!/^\d+$/.test(value)) throw unavailable();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable();
  return port;
};

export const parseSmtpConfig = (env: NodeJS.ProcessEnv): SmtpConfig => {
  const rawHost = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  const from = env.SMTP_FROM_ADDRESS?.trim();
  if (!rawHost || !user || !password || !from) throw unavailable();
  let host = rawHost;
  let embeddedPort: string | undefined;
  const match = rawHost.match(/^([^:]+):(\d+)$/);
  if (match) {
    host = match[1]!;
    embeddedPort = match[2]!;
  }
  else if (rawHost.includes(":")) throw unavailable();
  if (!validHost(host) || !validAddress(from)) throw unavailable();
  const port = parsePort(env.SMTP_PORT?.trim() || embeddedPort || "587");
  let secure = port === 465;
  if (env.SMTP_SECURE !== undefined && env.SMTP_SECURE.trim() !== "") {
    const value = env.SMTP_SECURE.trim();
    if (value !== "true" && value !== "false") throw unavailable();
    secure = value === "true";
  }
  return { host, port, secure, user, password, from };
};

export class SmtpMailService implements MailService {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async sendStatementCalendarEmail(email: ComposedEmail) {
    const config = parseSmtpConfig(this.env);
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.sendMail({
        from: config.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: [{ filename: email.attachment.filename, content: email.attachment.content, contentType: email.attachment.contentType }],
      });
    } catch {
      throw new MailDeliveryError("SMTP submission failed");
    } finally {
      transport.close();
    }
  }
  async sendPaymentReminder(email: ReminderEmail) {
    const config = parseSmtpConfig(this.env);
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    try { await transport.sendMail({ from: config.from, to: email.to, subject: email.subject, text: email.text, html: email.html }); }
    catch { throw new MailDeliveryError("SMTP submission failed"); }
    finally { transport.close(); }
  }
  async sendPasswordResetEmail(email: PasswordResetEmail) {
    const config = parseSmtpConfig(this.env);
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
    try {
      await transport.sendMail({
        from: config.from,
        to: email.to,
        subject: "Đặt lại mật khẩu Card Credit",
        text: `Mở liên kết sau để đặt lại mật khẩu (hết hạn lúc ${email.expiresAt.toISOString()}): ${email.resetLink}`,
        html: `<p>Bạn vừa yêu cầu đặt lại mật khẩu Card Credit.</p><p>Liên kết có hiệu lực đến <strong>${escapeHtml(email.expiresAt.toISOString())}</strong>:</p><p><a href="${escapeHtml(email.resetLink)}">Đặt lại mật khẩu</a></p>`,
      });
    } catch {
      throw new MailDeliveryError("SMTP submission failed");
    } finally {
      transport.close();
    }
  }
}

export const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
};
