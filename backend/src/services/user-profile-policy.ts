import { ApiError } from "../errors.js";

export const normalizeDisplayName = (value: unknown) => {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_DISPLAY_NAME", "Tên hiển thị không hợp lệ.", {
      displayName: "Tên hiển thị phải là chuỗi.",
    });
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > 80) {
    throw new ApiError(400, "INVALID_DISPLAY_NAME", "Tên hiển thị không hợp lệ.", {
      displayName: "Tên hiển thị tối đa 80 ký tự.",
    });
  }
  return normalized;
};
