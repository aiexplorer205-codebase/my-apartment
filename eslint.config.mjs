import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-sdk/*', '@google-cloud/*', 'firebase/*', '@firebase/*', 'firebase-admin', '@stripe/*', 'razorpay', '@twilio/*'],
              message: 'Provider SDKs must stay in infrastructure adapters, not domain/application code.',
            },
            {
              group: ['**/infrastructure/adapters/**', '**/infrastructure/**/postgres*', '**/infrastructure/**/redis*'],
              message: 'Client packages must not import persistence adapters directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/firebase*', '**/firebase-admin', '@aws-sdk/*', '@azure/*', '@stripe/*', 'razorpay', '@twilio/*'], message: 'Domain/application code cannot import provider SDKs.' }],
      }],
    },
  },
  {
    files: ['apps/admin-web/**/*.ts', 'apps/admin-web/**/*.tsx', 'apps/operator-web/**/*.ts', 'apps/operator-web/**/*.tsx', 'apps/resident-mobile/**/*.dart', 'apps/resident-mobile/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/infrastructure/adapters/**', '**/infrastructure/ports/**', '**/prisma/**', '**/postgres*', '**/redis*'], message: 'Client packages cannot import persistence adapters.' }],
      }],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.next/**', '.turbo/**', 'figma-prototype/**', '**/*.js', '**/*.d.ts'],
  },
]
