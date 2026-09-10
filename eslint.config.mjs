// Flat config. Next 16 removed `next lint`, and ESLint 9 no longer reads
// .eslintrc.json, so the previous setup was silently doing nothing at all:
// `npm run lint` failed on a missing directory, and a direct `eslint` run
// failed asking for this file. Neither surfaced as a lint error, so nothing
// was ever checked.
//
// Docs: node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // A leading underscore is this codebase's marker for "declared on
      // purpose, never read" -- lib/storage/image-value.ts uses it for
      // compile-time assertions that exist only to fail the build if the
      // branded image types are ever widened to plain string. Deleting those
      // to satisfy the linter would delete the check.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([
    // eslint-config-next's own defaults, which must be restated once anything
    // else is added here.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are full checkouts of this repo living inside it. Left
    // in, `eslint .` from the main checkout lints every file twice and reports
    // each finding against a path nobody edits.
    ".claude/**",
  ]),
]);
