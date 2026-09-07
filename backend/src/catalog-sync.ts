import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeCatalogProduct } from "./catalog.js";

const defaultCatalogPath = () => path.resolve(process.cwd(), "catalog/card-presets.json");

export const catalogPath = (env: NodeJS.ProcessEnv = process.env) =>
  env.CARD_CATALOG_PATH?.trim() || defaultCatalogPath();

export const readCatalogFile = async (filePath = catalogPath()) => {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("Card catalog baseline must be an array");
  return raw.map((entry) => normalizeCatalogProduct(entry as Record<string, unknown>));
};
