import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@wide-events/sdk/edge",
        replacement: path.join(repoRoot, "packages/sdk/src/edge/index.ts"),
      },
      {
        find: "@wide-events/sdk/instrumentation/pg",
        replacement: path.join(repoRoot, "packages/sdk/src/node/instrumentation/pg.ts"),
      },
      {
        find: "@wide-events/sdk/instrumentation/aws-sdk-v3",
        replacement: path.join(repoRoot, "packages/sdk/src/node/instrumentation/aws-sdk-v3.ts"),
      },
      {
        find: "@wide-events/sdk/instrumentation/ioredis",
        replacement: path.join(repoRoot, "packages/sdk/src/node/instrumentation/ioredis.ts"),
      },
      {
        find: "@wide-events/sdk",
        replacement: path.join(repoRoot, "packages/sdk/src/node/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    // The Node SDK intentionally keeps a process-global runtime registry.
    // Running files in parallel creates artificial cross-suite conflicts.
    fileParallelism: false,
    include: [
      "packages/**/*.test.ts",
      "examples/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});
