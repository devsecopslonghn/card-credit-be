import { ApiError } from "../errors.js";

export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
export const requirePassword = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 8) throw new ApiError(400, "INVALID_PASSWORD", "Mật khẩu không hợp lệ.", { password: "Mật khẩu phải có ít nhất 8 ký tự." });
  return value;
};
