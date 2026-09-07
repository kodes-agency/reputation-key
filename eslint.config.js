import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import query from '@tanstack/eslint-plugin-query'
import security from 'eslint-plugin-security'
import crossContextPublicApi from './eslint-rules/cross-context-public-api.mjs'
import zodV4 from './eslint-rules/zod-v4.mjs'

// BQC-5.1: local rules enforcing what eslint-plugin-boundaries cannot express.
const local = {
  rules: {
    'cross-context-public-api': crossContextPublicApi,
    'zod-v4': zodV4,
  },
}

const elementType = (type) => ({ element: { type } })
const elementTypes = (...types) => ({ element: { types: { anyOf: types } } })
const fileCategory = (categories) => ({ file: { categories } })
const localModule = { module: { origin: 'local' } }
const rootedElements = (descriptors) =>
  descriptors.map((descriptor) => ({ ...descriptor, partialMatch: false }))

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/dist-worker/**',
      '**/storybook-static/**',
      '**/node_modules/**',
      '**/.a5c/**',
      '**/.agents/**',
      'src/routeTree.gen.ts',
      'deacon/**',
      'reputation_key/**',
    ],
  },

  // Operational and CI scripts execute on the repository-pinned Node runtime.
  // Keep them in the lint gate with the runtime globals they actually receive;
  // do not make the whole repository ambiently Node-shaped because browser
  // modules should still catch accidental server-global use.
  {
    files: ['scripts/**/*.{ts,mjs}'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        Blob: 'readonly',
        Buffer: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        process: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Zod's package root and chained string formats retain legacy APIs. Keep
  // every executable TypeScript/JavaScript root on the explicitly pinned v4 API.
  {
    files: [
      '.storybook/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'e2e/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'scripts/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'server/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    ],
    plugins: { local },
    rules: { 'local/zod-v4': 'error' },
  },

  // ─── Architectural boundary enforcement ────────────────────────────
  // Specific context/shared/tooling descriptors precede their catch-alls.
  // Exact wiring seams use file categories; every other local edge defaults
  // to disallowed.
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'scripts/**/*.{ts,mjs}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': rootedElements([
        { type: 'domain', pattern: 'src/contexts/*/domain/**' },
        { type: 'application', pattern: 'src/contexts/*/application/**' },
        { type: 'application', pattern: 'src/contexts/*/ports/**' },
        { type: 'application', pattern: 'src/contexts/*/queries/**' },
        { type: 'infrastructure', pattern: 'src/contexts/*/infrastructure/**' },
        { type: 'server', pattern: 'src/contexts/*/server/**' },
        { type: 'context-ui', pattern: 'src/contexts/*/ui/**' },
        { type: 'routes', pattern: 'src/routes/**' },
        { type: 'components', pattern: 'src/components/**' },
        { type: 'ui-support', pattern: 'src/hooks/**' },
        { type: 'ui-support', pattern: 'src/lib/**' },
        { type: 'shared-domain', pattern: 'src/shared/domain/**' },
        { type: 'shared-db', pattern: 'src/shared/db/**' },
        { type: 'shared-auth', pattern: 'src/shared/auth/**' },
        { type: 'shared-jobs', pattern: 'src/shared/jobs/**' },
        { type: 'shared-queries', pattern: 'src/shared/queries/**' },
        { type: 'shared-health', pattern: 'src/shared/health/**' },
        { type: 'shared-governance', pattern: 'src/shared/governance/**' },
        { type: 'test-helpers', pattern: 'src/shared/testing/**' },
        { type: 'test-helpers', pattern: 'src/test-fixtures/**' },
        { type: 'test-helpers', pattern: 'test-fixtures/**' },
        { type: 'top-level', pattern: 'src/worker/**' },
        { type: 'runtime-plugin', pattern: 'server/**' },
        { type: 'story-fixtures', pattern: '.storybook/**' },
        { type: 'e2e-harness', pattern: 'e2e/**' },
        { type: 'script-ci', pattern: 'scripts/ci/**' },
        { type: 'script-ci', pattern: 'scripts/review/**' },
        { type: 'script-operator', pattern: 'scripts/ops/**' },
        { type: 'script-tooling', pattern: 'scripts/**' },
        { type: 'shared', pattern: 'src/shared/**' },
      ]),
      'boundaries/files': [
        { category: 'context-build', pattern: ['src/contexts/*/build.ts', 'src/contexts/*/build-*.ts'] },
        { category: 'shared-outbox-runtime', pattern: ['src/shared/outbox/relay.ts', 'src/shared/outbox/dispatcher.ts', 'src/shared/outbox/event-adapter.ts'] },
        { category: 'composition-root', pattern: ['src/composition.ts', 'src/composition/**/*.ts', 'src/bootstrap.ts'] },
        { category: 'start-entry', pattern: 'src/start.ts' },
        { category: 'router-entry', pattern: 'src/router.tsx' },
        { category: 'browser-entry', pattern: ['src/client.tsx', 'src/instrument.client.ts'] },
        { category: 'generated-router', pattern: 'src/routeTree.gen.ts' },
        { category: 'ambient-types', pattern: 'src/vite-env.d.ts' },
        { category: 'api-route', pattern: 'src/routes/api/**' },
        { category: 'deployable-containers', pattern: 'src/composition/deployables.ts' },
        { category: 'stylesheet', pattern: 'src/**/*.css' },
        { category: 'story-file', pattern: ['src/**/*.stories.ts', 'src/**/*.stories.tsx'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message: 'Architectural boundary violated. See src/contexts/CONTEXT.md "Dependency rules".',
          policies: [
            // Context, route and UI layers.
            { from: elementType('domain'), allow: { to: elementType('shared-domain') } },
            { from: elementType('application'), allow: { to: elementTypes('domain', 'application', 'shared', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: elementType('infrastructure'), allow: { to: elementTypes('domain', 'application', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: elementType('server'), allow: { to: elementTypes('domain', 'application', 'shared', 'shared-auth', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: elementType('server'), allow: { to: fileCategory('composition-root') } },
            { from: fileCategory('context-build'), allow: { to: elementTypes('domain', 'application', 'infrastructure', 'server', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: fileCategory('context-build'), allow: { to: fileCategory('context-build') } },
            { from: elementType('context-ui'), allow: { to: elementTypes('application', 'shared', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: elementType('routes'), allow: { to: elementTypes('server', 'application', 'components', 'context-ui', 'shared', 'shared-auth', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries', 'ui-support') } },
            { from: elementType('components'), allow: { to: elementTypes('components', 'context-ui', 'shared', 'shared-auth', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries', 'application', 'server', 'ui-support') } },
            { from: elementType('ui-support'), allow: { to: elementTypes('ui-support', 'shared', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            // Seven load-bearing shared areas plus the generic catch-all.
            { from: elementType('shared-domain'), allow: { to: elementType('shared-domain') } },
            { from: elementType('shared-db'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance') } },
            { from: elementType('shared-auth'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance') } },
            { from: elementType('shared-jobs'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs') } },
            { from: elementType('shared-health'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-health', 'shared-jobs') } },
            { from: elementType('shared-queries'), allow: { to: elementTypes('shared', 'shared-domain', 'shared-queries') } },
            { from: elementType('shared-governance'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance') } },
            { from: elementType('shared'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            // shared/events owns the generic shared area's domain-event edge.
            { from: elementType('shared'), allow: { to: elementType('domain') } },
            // Test helpers and process entry points.
            { from: elementType('test-helpers'), allow: { to: elementTypes('domain', 'application', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries', 'test-helpers') } },
            { from: elementType('test-helpers'), allow: { to: fileCategory('composition-root') } },
            { from: elementType('top-level'), allow: { to: elementTypes('domain', 'application', 'infrastructure', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: elementType('top-level'), allow: { to: fileCategory('composition-root') } },
            { from: fileCategory('composition-root'), allow: { to: elementTypes('domain', 'application', 'infrastructure', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: fileCategory('composition-root'), allow: { to: fileCategory(['composition-root', 'context-build']) } },
            { from: fileCategory('start-entry'), allow: { to: elementTypes('server', 'shared', 'shared-auth', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: fileCategory('router-entry'), allow: { to: elementTypes('components', 'ui-support', 'shared', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: fileCategory('router-entry'), allow: { to: fileCategory('generated-router') } },
            { from: fileCategory('browser-entry'), allow: { to: fileCategory('browser-entry') } },
            { from: fileCategory('browser-entry'), allow: { to: elementType('shared') } },
            { from: fileCategory('api-route'), allow: { to: fileCategory('composition-root') } },
            { from: elementType('runtime-plugin'), allow: { to: elementTypes('shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries') } },
            { from: elementType('runtime-plugin'), allow: { to: fileCategory('composition-root') } },
            // Repository tooling.
            { from: elementType('script-ci'), allow: { to: elementTypes('application', 'domain', 'shared', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries', 'test-helpers') } },
            { from: elementType('script-operator'), allow: { to: elementTypes('domain', 'application', 'infrastructure', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries', 'test-helpers') } },
            { from: elementType('script-operator'), allow: { to: fileCategory(['composition-root', 'context-build']) } },
            { from: elementType('script-tooling'), allow: { to: elementTypes('domain', 'application', 'infrastructure', 'shared', 'shared-auth', 'shared-db', 'shared-domain', 'shared-governance', 'shared-health', 'shared-jobs', 'shared-queries', 'test-helpers', 'script-operator', 'e2e-harness') } },
            { from: elementType('script-tooling'), allow: { to: fileCategory(['composition-root', 'context-build']) } },
            // Narrow runtime and composition seams.
            { disallow: { to: fileCategory('shared-outbox-runtime') } },
            { from: elementTypes('shared', 'top-level', 'test-helpers'), allow: { to: fileCategory('shared-outbox-runtime') } },
            { from: fileCategory('shared-outbox-runtime'), disallow: { to: localModule } },
            { from: fileCategory('shared-outbox-runtime'), allow: { to: elementTypes('shared', 'shared-db', 'shared-domain', 'shared-governance', 'shared-jobs') } },
            { from: fileCategory('shared-outbox-runtime'), disallow: { to: fileCategory('shared-outbox-runtime') } },
            { disallow: { to: fileCategory('deployable-containers') } },
            { from: elementTypes('top-level', 'test-helpers'), allow: { to: fileCategory('deployable-containers') } },
            { from: elementType('script-operator'), allow: { to: fileCategory('deployable-containers') } },
            { from: elementTypes('routes', 'components', 'router-entry'), allow: { to: fileCategory('stylesheet') } },
            { from: fileCategory('story-file'), allow: { to: elementType('story-fixtures') } },
          ],
        },
      ],
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown-dependencies': 'error',
    },
  },

  // ─── React and TanStack Query framework contracts ─────────────────
  // Scope the official flat-config recommendations to application source.
  // They catch render impurity/hook lifecycle defects and cache-key/query
  // contract drift that the general TypeScript rules cannot see.
  {
    files: [
      '.storybook/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/routes/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/lib/**/*.{ts,tsx}',
      'src/contexts/*/ui/**/*.{ts,tsx}',
      'src/shared/email/**/*.{ts,tsx}',
      'src/shared/hooks/**/*.{ts,tsx}',
      'src/router.tsx',
    ],
    plugins: {
      'react-hooks': reactHooks,
      '@tanstack/query': query,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...query.configs['flat/recommended'][0].rules,
      // CI never accepts framework-contract warnings: a newly introduced
      // stale closure or unsupported compiler construct must fail the gate.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-hooks/unsupported-syntax': 'error',
    },
  },

  // ─── BQC-5.1: cross-context public-api rule ────────────────────────
  // CONTEXT.md "Dependency rules": cross-context imports go through the
  // target context's application/public-api.ts only; infrastructure/adapters/**
  // may import the foreign application/ports/** contract they implement.
  {
    files: ['src/contexts/**/*.{ts,tsx}'],
    plugins: { local },
    rules: {
      'local/cross-context-public-api': 'error',
    },
  },

  // ─── no-restricted-imports: catch what boundaries can't ────────────
  // Enforces conventions that folder-based element matching can't express.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // drizzle-orm outside infrastructure/ and shared/db/ — use repository ports
            {
              group: ['drizzle-orm/**', 'drizzle-orm'],
              message:
                'Drizzle imports are only allowed in infrastructure/ and shared/db/schema/. Use repository ports instead.',
            },
            // React outside routes/, components/, integrations/ — business logic must be framework-free
            {
              group: [
                'react',
                'react-dom',
                'react/jsx-runtime',
                'react-dom/client',
                'react/jsx-dev-runtime',
              ],
              importNames: [
                'default',
                'createElement',
                'useState',
                'useEffect',
                'useCallback',
                'useMemo',
                'useRef',
                'Component',
                'PureComponent',
                'useContext',
                'useReducer',
                'useLayoutEffect',
              ],
              message:
                'React imports are only allowed in routes/, components/, and integrations/. Business logic must be framework-free.',
            },
          ],
        },
      ],
    },
  },

  // ─── Allow drizzle-orm in shared/db/ (schema definitions) ──────────
  // Per architecture: "Schemas live in shared/db/ because the Drizzle
  // schema barrel must be a single module."
  {
    files: ['src/shared/db/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [],
        },
      ],
    },
  },

  // ─── Allow drizzle-orm in infrastructure/ (repository implementations) ──
  // Per architecture: "Repository implementations using Drizzle" live in infrastructure/.
  // The boundaries plugin still enforces no React/domain-rule imports.
  {
    files: ['src/contexts/*/infrastructure/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ─── Allow drizzle-orm in shared/outbox/infrastructure/ (outbox repo) ──
  // PRE17A A3: The outbox repository uses Drizzle directly, same as context
  // infrastructure repos. Lives under shared/ because it's cross-context.
  {
    files: ['src/shared/outbox/infrastructure/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ─── Allow drizzle-orm in shared/observability/health-metrics (PRE17C) ──
  // Health metrics queries raw SQL via Drizzle for operational monitoring.
  // BQC-7.4: alert-aux-reads is the same operational-monitoring seam
  // (aggregate reads feeding the alert evaluation).
  {
    files: [
      'src/shared/observability/health-metrics.ts',
      'src/shared/observability/alert-aux-reads.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ─── Allow React in permitted locations ────────────────────────────
  // Re-enables no-restricted-imports for React, but keeps the barrel-only rule.
  {
    files: [
      'src/routes/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/router.tsx',
      'src/client.tsx',
    ],
    rules: {
      // React is allowed here — override the global restriction
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // Block deep imports into feature sub-folders — must go through barrel
            {
              group: ['#/components/features/*/*'],
              message:
                'Import from the feature barrel (e.g., "#/components/features/identity"), not from sub-folders. See src/components/CONTEXT.md.',
            },
          ],
        },
      ],
    },
  },

  // BQR-1.3 + BQC-5.1: domain must not import outbox internals, Node builtins,
  // or runtime infrastructure (bullmq/ioredis) — domain stays pure.
  // Public outbox surface is `#/shared/outbox` (barrel). Composition/worker
  // construct adapters.
  {
    files: ['src/contexts/*/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '#/shared/outbox/infrastructure/outbox-repository',
              message:
                'BQR-1.3: import OutboxRepository from #/shared/outbox (public barrel), not infrastructure.',
            },
            {
              name: '#/shared/outbox/relay',
              message: 'BQR-1.3: outbox relay is worker-only. Domain must not import it.',
            },
            {
              name: '#/shared/outbox/dispatcher',
              message:
                'BQR-1.3: outbox dispatcher is worker-only. Domain must not import it.',
            },
            {
              name: '#/shared/outbox/event-adapter',
              message:
                'BQR-1.3: event-adapter is internal. Use emitAndRecord from #/shared/outbox.',
            },
          ],
          patterns: [
            {
              group: ['**/shared/outbox/infrastructure/**'],
              message:
                'BQR-1.3: domain must not import outbox infrastructure. Use #/shared/outbox.',
            },
            {
              group: ['node:*'],
              message:
                'BQC-5.1: domain must stay runtime-free — no Node builtins (node:*). Domain is pure: types, rules, constructors, events, errors.',
            },
            {
              group: ['bullmq', 'ioredis'],
              message:
                'BQC-5.1: domain must not import runtime infrastructure (bullmq/ioredis). Domain is pure.',
            },
          ],
        },
      ],
    },
  },

  // BQR-1.3 + BQC-5.1: application must not import outbox internals or
  // queue/redis clients directly — durable work goes through ports wired by
  // the context build/composition.
  // node:* is deliberately NOT banned here: application use cases
  // legitimately use crypto (e.g. integration/application/use-cases/
  // get-google-auth-url.ts uses createHmac for OAuth state).
  {
    files: ['src/contexts/*/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '#/shared/outbox/infrastructure/outbox-repository',
              message:
                'BQR-1.3: import OutboxRepository from #/shared/outbox (public barrel), not infrastructure.',
            },
            {
              name: '#/shared/outbox/relay',
              message:
                'BQR-1.3: outbox relay is worker-only. Application must not import it.',
            },
            {
              name: '#/shared/outbox/dispatcher',
              message:
                'BQR-1.3: outbox dispatcher is worker-only. Application must not import it.',
            },
            {
              name: '#/shared/outbox/event-adapter',
              message:
                'BQR-1.3: event-adapter is internal. Use emitAndRecord from #/shared/outbox.',
            },
          ],
          patterns: [
            {
              group: ['**/shared/outbox/infrastructure/**'],
              message:
                'BQR-1.3: application must not import outbox infrastructure. Use #/shared/outbox.',
            },
            {
              group: ['bullmq', 'ioredis'],
              message:
                'BQC-5.1: application must not import bullmq/ioredis directly — depend on a port or the shared/jobs wiring surface.',
            },
          ],
        },
      ],
    },
  },

  // BQC-5.1: the events master union (shared/events) may import ONLY each
  // context's domain event modules — CONTEXT.md: "Cross-context type imports
  // are allowed for events only." Every other domain path is rejected.
  {
    files: ['src/shared/events/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/contexts/*/domain/**',
                '!**/contexts/*/domain/events',
                '!**/contexts/*/domain/events.ts',
                '!**/contexts/*/domain/*-events',
                '!**/contexts/*/domain/*-events.ts',
              ],
              message:
                'shared/events may only import context domain event modules (the master union). Other domain imports belong in the context itself.',
            },
          ],
        },
      ],
    },
  },

  // BQC-5.3: domain decisions must be runtime-neutral — time is a
  // parameter (CONTEXT.md / ADR 0017). No ambient wall-clock reads in
  // domain code; callers inject `now`/`asOf`. (Test files are exempt via
  // the test-files override below.)
  {
    files: ['src/contexts/*/domain/**/*.{ts,tsx}', 'src/shared/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'BQC-5.3: domain must receive time as a parameter (CONTEXT.md/ADR 0017) — inject now: Date instead of new Date().',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'BQC-5.3: domain must receive time as a parameter (CONTEXT.md/ADR 0017) — inject now: Date instead of Date.now().',
        },
      ],
    },
  },

  // Replaces src/shared/architecture/runtime-config-injection.test.ts, deleted
  // in WP1.2. That suite walked the import graph to prove routes and contexts
  // never read ambient configuration; the one rule it actually enforced is
  // expressible as a selector, so the lint carries it instead of a bespoke
  // authority module plus a source-text test.
  {
    files: ['src/routes/**/*.{ts,tsx}', 'src/contexts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'Read configuration through the container, not process.env — routes and contexts receive config as a dependency.',
        },
      ],
    },
  },

  // ─── BQC-7.7: static security analysis (eslint-plugin-security) ────
  // Recommended ruleset as ERRORS on production code — a red lint blocks the
  // PR (no continue-on-error). Deliberate, documented deviations (full triage
  // + rationale in docs/operations/security-ci-policy.md):
  //  - detect-object-injection OFF: the rule cannot distinguish typed-union
  //    record lookups / numeric array indices from user-controlled keys — all
  //    222 findings were sampled false positives (e.g.
  //    PERMISSION_CAPABILITY[permission], hops[clientIndex]). Prototype-
  //    pollution mitigation here is zod-validated boundaries + exhaustive-map
  //    guards (Object.hasOwn), not this rule.
  //  - test files + src/shared/testing: the whole ruleset is OFF — test code
  //    processes no untrusted input (227 findings, all false positives:
  //    fixture fs walks, in-memory repo indexers).
  //  - the handful of remaining production findings (bounded regexes flagged
  //    by safe-regex star-height, server-controlled fs paths) carry inline
  //    per-line disable comments with owner+reason at each site.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/test-setup.ts',
      'src/shared/testing/**',
    ],
    plugins: { security },
    rules: {
      ...Object.fromEntries(
        Object.keys(security.configs.recommended.rules).map((rule) => [rule, 'error']),
      ),
      'security/detect-object-injection': 'off',
    },
  },

  // ─── Test files: relaxed boundary rules ────────────────────────────
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/test-setup.ts',
    ],
    rules: {
      'boundaries/dependencies': 'off',
      'boundaries/no-unknown-files': 'off',
      'no-restricted-imports': 'off',
      'local/cross-context-public-api': 'off',
      // BQC-5.3: test fixtures build dates freely — the ambient-clock ban
      // applies to production domain code only.
      'no-restricted-syntax': 'off',
    },
  },

  // ─── ARC-03-T1: script test files ──────────────────────────────────
  // A script test must import the unit it covers, so dependency policies are
  // relaxed. Classification remains on: unclassified scripts must not escape
  // the repository-tooling policy.
  {
    files: ['scripts/**/*.test.{ts,mjs}'],
    rules: {
      'boundaries/dependencies': 'off',
    },
  },

  // ─── Component file length enforcement ─────────────────────────────
  // shadcn/ui primitives are auto-generated and not subject to our limits.
  // Files exceeding 150 lines are exempt until their feature is restructured
  // (Phase 2-4). New files and restructured files must comply.
  {
    ignores: [
      'src/components/ui/**',
      'src/components/features/portal/link-tree/link-tree.tsx',
      'src/components/layout/manager-sidebar.tsx',
      // Story files are fixtures (many variants), not components — not subject to the monolith limit.
      'src/**/*.stories.tsx',
      'src/**/*.stories.ts',
    ],
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      // Max file length to prevent monolith components. 300, because 200 was
      // being satisfied by splitting a page into sub-components that had one
      // caller and no independent meaning — fragmentation that reads as
      // structure. A page past 300 counted lines is genuinely doing too much.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
)
