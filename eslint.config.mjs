// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeBuiltins = {
  group: ['node:*'],
  message: 'Módulos do Node não são permitidos aqui.',
};

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Fronteira inviolável do motor de regras.
  {
    files: ['packages/rules-engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'rules-engine não pode depender de UI.' },
            { name: 'pixi.js', message: 'rules-engine não pode depender de UI.' },
            { name: 'electron', message: 'rules-engine não pode depender do Electron.' },
          ],
          patterns: [nodeBuiltins],
        },
      ],
    },
  },
  // Renderer: sem Electron e sem Node; tudo passa pelo preload.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'electron', message: 'O renderer usa só a API exposta em window.vtt.' }],
          patterns: [nodeBuiltins],
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
);
