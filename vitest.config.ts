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
    // Globs must be **-prefixed. "node_modules/**" matches only the root
    // one, so a nested checkout -- an agent worktree under .claude/, a
    // vendored package -- drops its dependencies' own test files into this
    // run. That is how a 6-file suite briefly became 169.
    exclude: ["**/node_modules/**", "**/.next/**", "**/.claude/**"],
    env: {
      ...env,
      // Pin a non-UTC, DST-observing timezone for the whole suite. Any
      // local-time-sensitive helper (e.g. lib/occasions/display.ts's
      // daysUntil, which reads a Date's LOCAL calendar fields) is
      // meaningless to test under TZ=UTC: local accessors
      // (getFullYear/getMonth/getDate) and their UTC counterparts
      // (getUTCFullYear/getUTCMonth/getUTCDate) agree on every instant when
      // the host's own timezone already IS UTC, so a bug that mixes the two
      // up cannot fail a test. America/New_York exercises that distinction
      // (a multi-hour offset from UTC, so evenings roll into the next UTC
      // day well before local midnight).
      TZ: "America/New_York",
    },
  },
  resolve: {
    // Must match the "@/*" -> "./*" mapping in tsconfig.json, or every
    // "@/..." import in a test fails to resolve.
    alias: { "@": resolve(__dirname, ".") },
  },
});
