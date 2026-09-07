import crypto from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(crypto.scrypt);
export const hashPassword = async (password: string) => {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${key.toString("base64url")}`;
};
export const verifyPassword = async (password: unknown, hash: string) => {
  if (typeof password !== "string") return false;
  const [algorithm, salt, encoded] = hash.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, "base64url");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};
