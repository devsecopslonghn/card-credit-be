import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

test("backend image keeps linked shared dependencies in a pruned runtime layer", () => {
  assert.equal((dockerfile.match(/npm --prefix \/shared ci --omit=dev/g) ?? []).length, 1);
  assert.match(dockerfile, /COPY --from=deps \/shared \/shared/);
  assert.match(dockerfile, /RUN npm run build[\s\S]*?RUN npm prune --omit=dev/);
  assert.equal((dockerfile.match(/FROM node:22-alpine@sha256:[a-f0-9]{64}/g) ?? []).length, 3);
  assert.match(dockerfile, /AS runner[\s\S]*?rm -rf \/usr\/local\/lib\/node_modules\/npm/);
  assert.match(dockerfile, /AS runner[\s\S]*?COPY --from=builder \/app\/node_modules \.\/node_modules/);
  assert.match(dockerfile, /AS runner[\s\S]*?COPY --from=builder \/shared \/shared/);
  assert.doesNotMatch(dockerfile, /AS runner[\s\S]*?npm --prefix \/shared ci/);
  assert.doesNotMatch(dockerfile, /CMD \["npm", "run", "start"\]/);
});
