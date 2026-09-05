// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // القاعدة 3: المال numeric/decimal — لا حساب عائم على المبالغ
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'المال بـ decimal.js — راجع القاعدة 3 في CLAUDE.md' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  prettier
)
