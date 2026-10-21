// Readability checks for the frontend (see CLAUDE.md "Readable code").
// Run: pnpm lint
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Size: files under 500 lines, components/functions under ~150.
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 150, skipBlankLines: true, skipComments: true }],
      // Hard-to-parse shapes.
      "complexity": ["error", 15],
      "max-depth": ["error", 4],
      "no-nested-ternary": "error",
      "max-statements-per-line": ["error", { max: 1 }],
      // Steam's runtime globals (SteamClient, collectionStore) are untyped.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
