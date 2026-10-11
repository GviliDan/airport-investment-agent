import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Import-boundary rules: dependencies point inward (see docs/architecture.md). */
const forbid = (...groups) => ({
  'no-restricted-imports': ['error', { patterns: groups }],
});
const external = (names, message) => ({ group: names, message });
const layers = (names, message) => ({ group: names.flatMap((n) => [`**/${n}`, `**/${n}/**`]), message });

const PURE_LAYER_EXTERNALS = [
  external(['express', 'express/*', 'next', 'next/*', 'react', 'react-dom'], 'Pure layers must not depend on HTTP or UI frameworks.'),
];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'apps/web/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Only config/env.ts may read process.env.
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/config/env.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "MemberExpression[object.name='process'][property.name='env']",
        message: 'Read configuration through config/env.ts only.',
      }],
    },
  },
  // domain: depends on nothing else in the app.
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: forbid(
      ...PURE_LAYER_EXTERNALS,
      layers(['analytics', 'scoring', 'application', 'agent', 'infrastructure', 'http', 'config'], 'domain must not import outer layers.'),
    ),
  },
  // analytics & scoring: domain only.
  {
    files: ['apps/api/src/analytics/**/*.ts', 'apps/api/src/scoring/**/*.ts'],
    rules: forbid(
      ...PURE_LAYER_EXTERNALS,
      layers(['application', 'agent', 'infrastructure', 'http', 'config'], 'analytics/scoring may import domain only.'),
    ),
  },
  // application: no adapters, agent or http.
  {
    files: ['apps/api/src/application/**/*.ts'],
    rules: forbid(
      ...PURE_LAYER_EXTERNALS,
      layers(['agent', 'infrastructure', 'http', 'config'], 'application depends on ports, not adapters.'),
    ),
  },
  // agent: no adapters, http, or vendor SDKs (only infrastructure/llm touches the SDK).
  {
    files: ['apps/api/src/agent/**/*.ts'],
    rules: forbid(
      external(['express', 'express/*'], 'agent depends on the LlmClient port and the application services, not frameworks.'),
      layers(['infrastructure', 'http'], 'agent must not import adapters or http.'),
    ),
  },
  // shared: contracts only; must not reach into the apps.
  {
    files: ['packages/shared/**/*.ts'],
    rules: forbid(
      { group: ['@airport/api', '@airport/web', '**/apps/**'], message: 'shared must not import from apps.' },
      external(['express', 'express/*', 'next', 'next/*', 'react', 'react-dom'], 'shared holds Zod contracts only.'),
    ),
  },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);
