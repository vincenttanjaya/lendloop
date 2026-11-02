import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
