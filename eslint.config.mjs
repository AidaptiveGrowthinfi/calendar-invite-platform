// ESLint 9 flat config.
//
// Kept deliberately small. The rules that matter in this project are not
// stylistic - they are the CI gates in scripts/, which enforce things a linter
// cannot see: one email normaliser, no drizzle-kit push, no ungenerated
// migration, and CONTEXT.md's vocabulary.
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/db/migrations/**',
      // Reference material, not project code. `tmp/mailVerify-inspect` is the
      // separate SMTP tool on ADR 0025's optional Option B path, and
      // `tmp/pdf-rendered` is a scratch directory.
      'tmp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // Scripts and migrations run in Node and write to stdout by design.
    files: ['scripts/**/*.mjs', 'packages/db/src/migrate.ts', 'packages/db/src/bootstrap-roles.ts'],
    rules: { 'no-console': 'off' },
  },
);
