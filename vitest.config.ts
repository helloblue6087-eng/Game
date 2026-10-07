import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Asset-level turns stream token by token with deliberate pacing, so the
    // integration suite needs more headroom than the vitest default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
