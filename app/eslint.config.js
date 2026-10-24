// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Hot paths must not allocate per frame; flag the obvious offenders in render/ and game/.
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'NewExpression[callee.name=/^(Vector2|Vector3|Quaternion|Matrix4|Color)$/]',
          message:
            'Avoid allocating Three.js math objects in hot paths; reuse module-level scratch instances (docs/16-performance-budget.md).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', 'eslint.config.js', 'vite.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
