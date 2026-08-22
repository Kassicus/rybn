import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "node:path";

// Vitest does not load .env.local automatically the way `next dev` does.
// Reuse Vite's own loader (a transitive dependency of vitest) so the test
// process sees the same NEXT_PUBLIC_* values the app is built with. The
// empty-string prefix disables Vite's default "only VITE_*" filter, since
// this repo's public vars use the Next.js NEXT_PUBLIC_ convention instead.
const env = loadEnv("", process.cwd(), "");

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    env,
  },
  resolve: {
    // Must match the "@/*" -> "./*" mapping in tsconfig.json, or every
    // "@/..." import in a test fails to resolve.
    alias: { "@": resolve(__dirname, ".") },
  },
});
