/**
 * Vitest configuration for the backend test suite.
 *
 * - Uses the "node" environment (no DOM).
 * - Picks up any *.test.ts file under src/tests/.
 * - Covers all source files under src/ for coverage reporting.
 * - Globals enabled so `describe/it/expect` work without explicit imports.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",

    // Only run test files under src/tests/ to avoid accidentally running
    // build or config files.
    include: ["src/tests/**/*.test.ts"],

    // Alias resolution: map bare specifiers that use the .js extension
    // (required by TypeScript ESM) back to their .ts source files so Vitest
    // can import them directly during testing.
    alias: [
      // Map local .js imports to their .ts source equivalents.
      { find: /^(\.{1,2}\/.+)\.js$/, replacement: "$1" },
    ],

    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**", "src/index.ts"],
      reporter: ["text", "html", "lcov"],
    },
  },
});
