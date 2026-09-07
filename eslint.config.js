// @ts-check

import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['dist', 'dist-test', 'editors/*/dist', '*.tsbuildinfo'],
  },
  {
    files: ['src/**/*.ts', 'editors/*/src/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      eslintConfigPrettier,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type aliases are preferred, but interfaces are okay if there's a
      // motivating reason to use one.
      '@typescript-eslint/consistent-type-definitions': 'off',

      // TODO: Enable once I migrate away from `makeObjectNode`.
      '@typescript-eslint/no-deprecated': 'off',

      // `{}` is a useful type, this is a dumb lint rule.
      '@typescript-eslint/no-empty-object-type': 'off',

      // Forbid type assertions unless they're explicitly commented.
      '@typescript-eslint/no-unsafe-type-assertion': 'error',

      // Allow `_`-prefixed unused variables.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      // Allow some primitive types in template interpolations.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowBoolean: true,
          allowNumber: true,
          allow: [{ name: 'BigInt', from: 'lib' }],
        },
      ],
    },
  },
  {
    // `node:test` returns a Promise from `test()`/`suite()` but the runner
    // doesn't require top-level awaits.
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
)
