export const READ_DEFAULT_LIMIT = 100;
export const READ_MAX_LIMIT = 100;

export const boundedReadLimit = (value: unknown) => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : READ_DEFAULT_LIMIT;
  const safe = Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : READ_DEFAULT_LIMIT;
  return Math.min(Math.max(safe, 1), READ_MAX_LIMIT);
};
