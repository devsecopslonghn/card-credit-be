import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const backendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const frontendRoot = resolve(globalThis.process.argv[2] ?? "../card-credit-fe");
const pairs = [
  [resolve(backendRoot, "shared/src"), resolve(frontendRoot, "src/contracts"), "contracts"],
  [resolve(backendRoot, "backend/catalog/card-presets.json"), resolve(frontendRoot, "src/data/card-presets.json"), "card catalog"],
];

const files = async (directory) => (await import("node:fs/promises")).readdir(directory, { withFileTypes: true }).then((entries) => entries.filter((entry) => entry.isFile() && entry.name.endsWith(".js")).map((entry) => entry.name).sort());
const mismatches = [];
for (const [left, right, label] of pairs) {
  const leftFiles = (await import("node:fs/promises")).stat(left).then((value) => value.isDirectory() ? files(left) : Promise.resolve(["__single__"]));
  const rightFiles = (await import("node:fs/promises")).stat(right).then((value) => value.isDirectory() ? files(right) : Promise.resolve(["__single__"]));
  const [leftNames, rightNames] = await Promise.all([leftFiles, rightFiles]);
  if (leftNames.join("\n") !== rightNames.join("\n")) mismatches.push(`${label}: file sets differ`);
  for (const name of leftNames) {
    const leftPath = name === "__single__" ? left : resolve(left, name);
    const rightPath = name === "__single__" ? right : resolve(right, name);
    const [leftText, rightText] = await Promise.all([readFile(leftPath, "utf8"), readFile(rightPath, "utf8")]);
    if (leftText !== rightText) mismatches.push(`${label}: ${name}`);
  }
}
if (mismatches.length) {
  globalThis.console.error("Contract/catalog drift detected:");
  for (const mismatch of mismatches) globalThis.console.error(`- ${mismatch}`);
  globalThis.process.exit(1);
}
globalThis.console.log("Frontend/backend contracts and card catalog are byte-identical.");
