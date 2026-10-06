import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import query from '@tanstack/eslint-plugin-query'
import security from 'eslint-plugin-security'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import crossContextPublicApi from './eslint-rules/cross-context-public-api.mjs'
import zodV4 from './eslint-rules/zod-v4.mjs'

// BQC-5.1: local rules enforcing what eslint-plugin-boundaries cannot express.
const local = {
  rules: {
    'cross-context-public-api': crossContextPublicApi,
    'zod-v4': zodV4,
  },
}

// ─── UI consistency rules (docs/design/ui-system, section 6.1) ──────────────
// ESLint's own `no-restricted-syntax` and `no-restricted-imports`, registered
// under rule names of their own. Flat config gives a rule one severity and
// replaces its options in every later block that matches the same file, and
// src/routes/** already carries `no-restricted-syntax` at `error` for ambient
// config reads. Under their own names the UI rules stay at `warn` (decision 11:
// new rules start at warn with a checked-in baseline, and become `error` when a
// rule's baseline is empty), keep their own file scope and allowlist, and are
// counted per rule. Each name below is one rule of the pattern index.
const noRestrictedSyntax = builtinRules.get('no-restricted-syntax')
const noRestrictedImports = builtinRules.get('no-restricted-imports')
const uiPattern = {
  rules: {
    'important-ink': noRestrictedSyntax,
    'palette-colour': noRestrictedSyntax,
    'fill-grade-red-text': noRestrictedSyntax,
    'destructive-class': noRestrictedSyntax,
    'control-size': noRestrictedSyntax,
    'raw-button': noRestrictedSyntax,
    'load-more-label': noRestrictedSyntax,
    'gutter-bleed': noRestrictedSyntax,
    'case-folded-search': noRestrictedSyntax,
    'route-page-state': noRestrictedSyntax,
    'unavailable-redirect': noRestrictedSyntax,
    'role-denial-redirect': noRestrictedSyntax,
    'alert-glyph-aliases': noRestrictedImports,
    'strip-scroll-imports': noRestrictedImports,
  },
}

// `esquery` regex literals cannot hold a `/`, so a class with a slash (an
// opacity, a fraction) is written with `\x2f`.
/** Every string in the file: a class in a variant map, a `cn()` argument, a template. */
const anyString = (pattern) => [
  `Literal[value=/${pattern}/]`,
  `TemplateElement[value.raw=/${pattern}/]`,
]
/** Every string in the `className` of the named JSX elements. */
const classOf = (elements, pattern) =>
  [`Literal[value=/${pattern}/]`, `TemplateElement[value.raw=/${pattern}/]`].map(
    (leaf) =>
      `JSXOpeningElement[name.name=/^(?:${elements})$/] > JSXAttribute[name.name='className'] ${leaf}`,
  )
const withMessage = (selectors, message) =>
  selectors.map((selector) => ({ selector, message }))

// The component and route sources, as the source guards under src/components read them.
const UI_SOURCES = ['src/components/**/*.{ts,tsx}', 'src/routes/**/*.{ts,tsx}']
const NOT_A_UI_SOURCE = [
  '**/*.test.{ts,tsx}',
  '**/*.stories.{ts,tsx}',
  '**/__fixtures__/**',
  '**/*-fixtures.{ts,tsx}',
]
// The guest renderer is the owner's reference experience and keeps its own CSS and colours.
const GUEST_RENDERER = 'src/components/features/guest/**'
const ROUTE_SOURCES = ['src/routes/**/*.{ts,tsx}']

const elementType = (type) => ({ element: { type } })
const elementTypes = (...types) => ({ element: { types: { anyOf: types } } })
const fileCategory = (categories) => ({ file: { categories } })
const localModule = { module: { origin: 'local' } }
const rootedElements = (descriptors) =>
  descriptors.map((descriptor) => ({ ...descriptor, partialMatch: false }))

// Named target sets keep the policy rows readable; every row that could reach a
// shared area before the Phase 4 collapse reaches the same areas now.
const CONTEXT = ['domain', 'application']
const UI = ['components', 'ui-support']
const SHARED_CORE = ['shared', 'shared-auth', 'shared-domain', 'shared-governance']
const SHARED_BROWSER = [
  'shared',
  'shared-domain',
  'shared-governance',
  'shared-health',
  'shared-jobs',
  'shared-queries',
]
const SHARED_SERVER = [...SHARED_BROWSER, 'shared-auth']
const SHARED_ALL = [...SHARED_SERVER, 'shared-db', 'shared-events']

// `no-restricted-syntax` selector sets. Flat config replaces a rule's options
// instead of merging them, so a block that shares files with another must list
// every selector set those files need.
const WALL_CLOCK_READS = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'BQC-5.3: domain must receive time as a parameter (CONTEXT.md/ADR 0017) — inject now: Date instead of new Date().',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      'BQC-5.3: domain must receive time as a parameter (CONTEXT.md/ADR 0017) — inject now: Date instead of Date.now().',
  },
]
const AMBIENT_CONFIG_READS = [
  {
    selector:
      "MemberExpression[object.object.name='process'][object.property.name='env']",
    message:
      'Read configuration through the container, not process.env — routes and contexts receive config as a dependency.',
  },
]

// `no-restricted-imports` bans every src/** file gets from the global block.
// A block that sets its own `no-restricted-imports` replaces those options, so
// it must spread back each ban its files still need.
// drizzle-orm outside infrastructure/ and shared/db/ — use repository ports.
const DRIZZLE_IMPORTS = {
  group: ['drizzle-orm/**', 'drizzle-orm'],
  message:
    'Drizzle imports are only allowed in infrastructure/ and shared/db/schema/. Use repository ports instead.',
}
// React outside routes/, components/, integrations/ — business logic must be
// framework-free.
const REACT_IMPORTS = {
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
}

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
        { type: 'legal-source', pattern: 'docs/legal/**' },
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
        { type: 'shared-events', pattern: 'src/shared/events/**' },
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
        {
          category: 'context-build',
          pattern: ['src/contexts/*/build.ts', 'src/contexts/*/build-*.ts'],
        },
        {
          category: 'shared-outbox-runtime',
          pattern: [
            'src/shared/outbox/relay.ts',
            'src/shared/outbox/dispatcher.ts',
            'src/shared/outbox/event-adapter.ts',
          ],
        },
        {
          category: 'composition-root',
          pattern: ['src/composition.ts', 'src/composition/**/*.ts', 'src/bootstrap.ts'],
        },
        { category: 'start-entry', pattern: 'src/start.ts' },
        { category: 'router-entry', pattern: 'src/router.tsx' },
        {
          category: 'browser-entry',
          pattern: ['src/client.tsx', 'src/instrument.client.ts'],
        },
        { category: 'generated-router', pattern: 'src/routeTree.gen.ts' },
        { category: 'ambient-types', pattern: 'src/vite-env.d.ts' },
        { category: 'api-route', pattern: 'src/routes/api/**' },
        {
          category: 'deployable-containers',
          pattern: 'src/composition/operator-container.ts',
        },
        { category: 'stylesheet', pattern: 'src/**/*.css' },
        {
          category: 'story-file',
          pattern: ['src/**/*.stories.ts', 'src/**/*.stories.tsx'],
        },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Architectural boundary violated. See src/contexts/CONTEXT.md "Dependency rules".',
          policies: [
            // Context, route and UI layers.
            { from: elementType('domain'), allow: { to: elementType('shared-domain') } },
            {
              from: elementType('application'),
              allow: { to: elementTypes(...CONTEXT, ...SHARED_BROWSER, 'shared-events') },
            },
            {
              from: elementType('infrastructure'),
              allow: { to: elementTypes(...CONTEXT, ...SHARED_ALL) },
            },
            {
              from: elementType('server'),
              allow: { to: elementTypes(...CONTEXT, ...SHARED_SERVER, 'shared-events') },
            },
            {
              from: elementType('server'),
              allow: { to: fileCategory('composition-root') },
            },
            {
              from: fileCategory('context-build'),
              allow: {
                to: elementTypes(...CONTEXT, 'infrastructure', 'server', ...SHARED_ALL),
              },
            },
            {
              from: fileCategory('context-build'),
              allow: { to: fileCategory('context-build') },
            },
            {
              from: elementType('context-ui'),
              allow: { to: elementTypes('application', ...SHARED_BROWSER) },
            },
            {
              from: elementType('routes'),
              allow: {
                to: elementTypes(
                  ...UI,
                  'server',
                  'application',
                  'context-ui',
                  ...SHARED_SERVER,
                  'legal-source',
                ),
              },
            },
            {
              from: elementType('components'),
              allow: {
                to: elementTypes(
                  ...UI,
                  'context-ui',
                  'application',
                  'server',
                  ...SHARED_SERVER,
                ),
              },
            },
            {
              from: elementType('ui-support'),
              allow: { to: elementTypes('ui-support', ...SHARED_BROWSER) },
            },
            // Seven load-bearing shared areas plus the generic catch-all. Only shared/events
            // reaches a context's domain (its *events* modules, per the block below); the
            // browser-reachable queries area reaches nothing else in shared.
            {
              from: elementType('shared-domain'),
              allow: { to: elementType('shared-domain') },
            },
            {
              from: elementType('shared-db'),
              allow: { to: elementTypes(...SHARED_CORE, 'shared-db') },
            },
            {
              from: elementType('shared-auth'),
              allow: { to: elementTypes(...SHARED_CORE, 'shared-db') },
            },
            {
              from: elementType('shared-jobs'),
              allow: {
                to: elementTypes(
                  ...SHARED_CORE,
                  'shared-db',
                  'shared-events',
                  'shared-health',
                  'shared-jobs',
                ),
              },
            },
            {
              from: elementType('shared-health'),
              allow: {
                to: elementTypes(
                  ...SHARED_CORE,
                  'shared-db',
                  'shared-health',
                  'shared-jobs',
                ),
              },
            },
            {
              from: elementType('shared-queries'),
              allow: { to: elementType('shared-queries') },
            },
            {
              from: elementType('shared-governance'),
              allow: { to: elementTypes(...SHARED_CORE, 'shared-db') },
            },
            {
              from: elementType('shared'),
              allow: {
                to: elementTypes(
                  ...SHARED_CORE,
                  'shared-db',
                  'shared-events',
                  'shared-health',
                  'shared-jobs',
                  'shared-queries',
                ),
              },
            },
            {
              from: elementType('shared-events'),
              allow: { to: elementTypes('domain', 'shared', 'shared-domain') },
            },
            // Test helpers and process entry points.
            {
              from: elementType('test-helpers'),
              allow: { to: elementTypes(...CONTEXT, ...SHARED_ALL, 'test-helpers') },
            },
            {
              from: elementType('test-helpers'),
              allow: { to: fileCategory('composition-root') },
            },
            {
              from: elementType('top-level'),
              allow: { to: elementTypes(...CONTEXT, 'infrastructure', ...SHARED_ALL) },
            },
            {
              from: elementType('top-level'),
              allow: { to: fileCategory('composition-root') },
            },
            {
              from: fileCategory('composition-root'),
              allow: { to: elementTypes(...CONTEXT, 'infrastructure', ...SHARED_ALL) },
            },
            {
              from: fileCategory('composition-root'),
              allow: { to: fileCategory(['composition-root', 'context-build']) },
            },
            {
              from: fileCategory('start-entry'),
              allow: { to: elementTypes('server', ...SHARED_SERVER) },
            },
            {
              from: fileCategory('router-entry'),
              allow: { to: elementTypes(...UI, ...SHARED_BROWSER) },
            },
            {
              from: fileCategory('router-entry'),
              allow: { to: fileCategory('generated-router') },
            },
            {
              from: fileCategory('browser-entry'),
              allow: { to: fileCategory('browser-entry') },
            },
            { from: fileCategory('browser-entry'), allow: { to: elementType('shared') } },
            {
              from: fileCategory('api-route'),
              allow: { to: fileCategory('composition-root') },
            },
            {
              from: elementType('runtime-plugin'),
              allow: { to: elementTypes(...SHARED_ALL) },
            },
            {
              from: elementType('runtime-plugin'),
              allow: { to: fileCategory('composition-root') },
            },
            // Repository tooling.
            {
              from: elementType('script-ci'),
              allow: { to: elementTypes(...CONTEXT, ...SHARED_BROWSER, 'test-helpers') },
            },
            {
              from: elementType('script-operator'),
              allow: {
                to: elementTypes(
                  ...CONTEXT,
                  'infrastructure',
                  ...SHARED_ALL,
                  'test-helpers',
                ),
              },
            },
            {
              from: elementType('script-operator'),
              allow: { to: fileCategory(['composition-root', 'context-build']) },
            },
            {
              from: elementType('script-tooling'),
              allow: {
                to: elementTypes(
                  ...CONTEXT,
                  'infrastructure',
                  ...SHARED_ALL,
                  'test-helpers',
                  'script-operator',
                  'e2e-harness',
                ),
              },
            },
            {
              from: elementType('script-tooling'),
              allow: { to: fileCategory(['composition-root', 'context-build']) },
            },
            // Narrow runtime and composition seams. The relay may not reach shared-auth.
            { disallow: { to: fileCategory('shared-outbox-runtime') } },
            {
              from: elementTypes('shared', 'top-level', 'test-helpers'),
              allow: { to: fileCategory('shared-outbox-runtime') },
            },
            {
              from: fileCategory('shared-outbox-runtime'),
              disallow: { to: localModule },
            },
            {
              from: fileCategory('shared-outbox-runtime'),
              allow: {
                to: elementTypes(
                  'shared',
                  'shared-db',
                  'shared-domain',
                  'shared-events',
                  'shared-governance',
                  'shared-jobs',
                ),
              },
            },
            {
              from: fileCategory('shared-outbox-runtime'),
              disallow: { to: fileCategory('shared-outbox-runtime') },
            },
            { disallow: { to: fileCategory('deployable-containers') } },
            {
              from: elementType('script-operator'),
              allow: { to: fileCategory('deployable-containers') },
            },
            {
              from: elementTypes('routes', 'components', 'router-entry'),
              allow: { to: fileCategory('stylesheet') },
            },
            {
              from: fileCategory('story-file'),
              allow: { to: elementType('story-fixtures') },
            },
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
          patterns: [DRIZZLE_IMPORTS, REACT_IMPORTS],
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
            // React is allowed here; direct database access still is not.
            DRIZZLE_IMPORTS,
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
            DRIZZLE_IMPORTS,
            REACT_IMPORTS,
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
            DRIZZLE_IMPORTS,
            REACT_IMPORTS,
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
            DRIZZLE_IMPORTS,
            REACT_IMPORTS,
          ],
        },
      ],
    },
  },

  // BQC-5.3: domain decisions must be runtime-neutral — time is a
  // parameter (CONTEXT.md / ADR 0017). No ambient wall-clock reads in
  // domain code; callers inject `now`/`asOf`. (Test files are exempt via
  // the test-files override below.) Context domain code gets its selectors
  // from the block after the process.env one.
  {
    files: ['src/shared/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...WALL_CLOCK_READS],
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
      'no-restricted-syntax': ['error', ...AMBIENT_CONFIG_READS],
    },
  },

  // Context domain code is under both bans. This block must follow the
  // process.env one, which would otherwise replace the wall-clock selectors
  // (src/shared/architecture/ambient-reads-eslint-rule.test.ts).
  {
    files: ['src/contexts/*/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...WALL_CLOCK_READS, ...AMBIENT_CONFIG_READS],
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
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-setup.ts'],
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

  // ─── UI consistency rules, all at `warn` ────────────────────────────
  // See the pattern index in src/components/CONTEXT.md for the primitive each
  // rule points to, and docs/design/ui-system/ui-consistency-scan-2026-10-02.md
  // (section 6.1) for the finding it would have prevented.

  // FRAME-06, NAV-02, ACT-19. The anchor default moved into @layer base, so a
  // utility on a link wins and nothing needs an `!`. Replaces the "ink pins" test
  // in src/components/ui/link-ink.test.ts once the baseline is empty.
  {
    files: UI_SOURCES,
    // The one icon inside a destructive menu item fights a sibling arbitrary-variant rule.
    ignores: [...NOT_A_UI_SOURCE, 'src/components/ui/dropdown-menu.tsx'],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/important-ink': [
        'warn',
        ...withMessage(
          anyString(
            String.raw`(?:^|[\s:])(?:!(?:text|decoration)-[\w()\x2f.%-]+|!(?:no-)?underline\b|(?:text|decoration)-[\w()\x2f.%-]+!|(?:no-)?underline!)(?=\s|$)`,
          ),
          'An important modifier on a colour or a decoration. A utility on a link wins on its own (the anchor default is in @layer base); a component with its own ink opts out by data-slot. See "Links" in the pattern index.',
        ),
      ],
    },
  },

  // SURF-11, COLL-09. The tokens in styles.css are the palette. The same check
  // runs as src/components/ui/tone-sources.test.ts (raw palette colours); this is
  // the editor-time form.
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, GUEST_RENDERER],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/palette-colour': [
        'warn',
        ...withMessage(
          anyString(
            String.raw`\b(?:text|bg|border|fill|stroke|ring|from|to|via|divide|outline|decoration|shadow|accent|caret)-(?:amber|emerald|red|green|yellow|neutral|gray|grey|slate|zinc|stone|orange|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b`,
          ),
          'A Tailwind palette colour. Colour comes from the tokens in styles.css (text-positive, text-warn, text-negative, bg-positive-muted ...); a status is an Alert, a Badge tone or a StatusBadge.',
        ),
      ],
    },
  },

  // SURF-11. Red text is `text-negative`, the text-grade red; `text-destructive`
  // is the fill a destructive button is painted with (shadcn's default for an
  // error line, which is why it is typed so often). Also tone-sources.test.ts.
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, GUEST_RENDERER],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/fill-grade-red-text': [
        'warn',
        ...withMessage(
          anyString(String.raw`(?<![\w-])text-destructive(?![\w-])`),
          'text-destructive is the fill-grade red. Red text is text-negative; a failure is a FormErrorBanner, an Alert or a toast.',
        ),
      ],
    },
  },

  // ACT-01, SURF-01, FORM-02, ACT-17. The destructive look is a variant of the
  // primitive (on-fill ink included), not a colour typed on a button.
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, 'src/components/ui/**'],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/destructive-class': [
        'warn',
        ...withMessage(
          classOf(
            'Button|IconButton|SubmitButton|AlertDialogAction|ConfirmationTrigger',
            String.raw`(?<![\w-])(?:bg-destructive|text-destructive-foreground|text-white)(?![\w-])`,
          ),
          'A destructive colour typed on a button. Use variant="destructive" (a ConfirmationTrigger for a confirmation); the primitive owns the fill and the on-fill ink in both themes.',
        ),
      ],
    },
  },

  // ACT-03, FORM-15, COLL-02, FRAME-12. A control's height is the primitive's
  // (44px below md, its own desktop height from md, 36px under data-density="compact").
  // src/components/ui/button-sources.test.ts covers Button only.
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, 'src/components/ui/**'],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/control-size': [
        'warn',
        ...withMessage(
          classOf(
            'Button|IconButton|SubmitButton|Input|SelectTrigger|DropdownMenuItem|RowActionsItem|ConfirmationTrigger',
            String.raw`(?:^|\s)(?:(?:max-)?(?:sm|md|lg|xl):)*(?:min-)?(?:h|size)-(?:\d|\[|\()`,
          ),
          'A height or size on a control. The primitive owns it: touch below md, data-density="compact" on a dense container, size="xs" with touch for a small tap target. Add a size or variant to the primitive instead.',
        ),
      ],
    },
  },

  // ACT-10. A control that acts is a Button (an IconButton, a RowActionsMenu, a
  // ConfirmationTrigger). A selectable tile or row that is a button by design may
  // stay: say why in a comment and disable the line.
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, 'src/components/ui/**', GUEST_RENDERER],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/raw-button': [
        'warn',
        {
          selector: "JSXOpeningElement[name.name='button']",
          message:
            'A raw <button>. Use Button or IconButton (RowActionsMenu for a row menu). A selectable tile or row that is a button by design may stay: say why beside it.',
        },
      ],
    },
  },

  // COLL-16. A cursor feed's "Load more" is a LoadMoreButton (aria-disabled while it
  // loads so focus stays, "Try again" after a failure).
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, 'src/components/ui/load-more-button.tsx'],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/load-more-label': [
        'warn',
        {
          selector:
            "JSXElement[openingElement.name.name='Button'] > JSXText[value=/Load (?:more|earlier)/]",
          message:
            'A hand-made "Load more". A cursor feed uses LoadMoreButton (label for what it loads), which keeps focus while it loads and offers "Try again" after a failure.',
        },
      ],
    },
  },

  // FRAME-01, FORM-04. <main> owns the page gutter. A phone row that bleeds out of it
  // is PAGE_GUTTER_BLEED_PHONE from layout/page-shell, which agrees with the gutter by
  // construction (layout/page-shell.test.ts covers the gutter itself, not the bleed).
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, 'src/components/layout/page-shell.tsx'],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/gutter-bleed': [
        'warn',
        ...withMessage(
          anyString(String.raw`(?:^|\s)(?:(?:max-)?(?:sm|md|lg|xl):)?-mx-[46](?![\w-])`),
          'A hand-typed gutter bleed (-mx-4, -mx-6). The page gutter has one owner: use PAGE_GUTTER_BLEED_PHONE from #/components/layout/page-shell, or FullBleedFrame.',
        ),
      ],
    },
  },

  // COLL-07. A list matches with searchMatcher, which folds case and accents:
  // "cafe" finds "Café".
  {
    files: UI_SOURCES,
    ignores: NOT_A_UI_SOURCE,
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/case-folded-search': [
        'warn',
        {
          selector:
            "CallExpression[callee.property.name='includes'][callee.object.callee.property.name=/^to(?:Locale)?LowerCase$/]",
          message:
            'A case-folded includes() is not a search match. Use searchMatcher from #/components/property/property-search, which folds case and accents.',
        },
      ],
    },
  },

  // FRAME-02, FRAME-03, FRAME-04, SURF-10. A route file names its page and loads
  // its data; the states are the router defaults (RoutePending, RouteError,
  // RouteNotFound, through PageState) and the feature component's regions.
  // src/routes/route-boundaries.test.ts covers the three route options, not markup.
  {
    files: ROUTE_SOURCES,
    ignores: NOT_A_UI_SOURCE,
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/route-page-state': [
        'warn',
        {
          selector:
            'JSXOpeningElement[name.name=/^(?:Skeleton|Alert|EmptyState|ErrorState|LoadingState|RegionError)$/]',
          message:
            'A route draws no loading, error or empty state of its own. A page state is PageState through the router defaults; a region state belongs in the feature component (EmptyState, RegionError).',
        },
      ],
    },
  },

  // FRAME-07. /unavailable is for an account with no workspace, decided by the
  // shell route. A page that cannot be opened throws roleUnavailable,
  // gateControlledRoute or routeNotice, which draw an in-shell state.
  {
    files: ROUTE_SOURCES,
    ignores: [
      ...NOT_A_UI_SOURCE,
      'src/routes/_authenticated.tsx',
      'src/routes/unavailable.tsx',
    ],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/unavailable-redirect': [
        'warn',
        {
          selector: "Property[key.name='to'][value.value='/unavailable']",
          message:
            'Only the authenticated shell sends an account with no workspace to /unavailable. A denied or switched-off page throws roleUnavailable, gateControlledRoute or routeNotice (an in-shell state with a way back).',
        },
      ],
    },
  },

  // FRAME-07. A role denial is a notice, not a silent bounce to another page.
  {
    files: ROUTE_SOURCES,
    ignores: NOT_A_UI_SOURCE,
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/role-denial-redirect': [
        'warn',
        ...withMessage(
          [
            "IfStatement:has(CallExpression[callee.name='can']) > ThrowStatement > CallExpression[callee.name='redirect']",
            "IfStatement:has(CallExpression[callee.name='can']) > BlockStatement > ThrowStatement > CallExpression[callee.name='redirect']",
          ],
          'A permission check that redirects hides the reason. Throw roleUnavailable(title, back) so the person sees what they cannot open and the way back.',
        ),
      ],
    },
  },

  // SURF-05, SURF-11. A tone draws its own icon (TONE_ICON in ui/tone.ts); the
  // older lucide names are the same shapes under other names.
  {
    files: UI_SOURCES,
    ignores: [...NOT_A_UI_SOURCE, 'src/components/ui/tone.ts'],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/alert-glyph-aliases': [
        'warn',
        {
          paths: [
            {
              name: 'lucide-react',
              importNames: [
                'AlertCircle',
                'AlertTriangle',
                'AlertOctagon',
                'OctagonAlert',
                'CheckCircle',
                'CheckCircle2',
                'XCircle',
              ],
              message:
                'The product glyphs are CircleAlert, TriangleAlert, CircleCheck and CircleX; a tone wears TONE_ICON from #/components/ui/tone.',
            },
          ],
        },
      ],
    },
  },

  // NAV-01, NAV-05. The scrolling-row mechanics belong to the primitives that
  // draw a strip: a section nav is a SectionNav, a page's views are LinkTabs.
  {
    files: UI_SOURCES,
    ignores: [
      ...NOT_A_UI_SOURCE,
      'src/components/ui/**',
      'src/components/inbox/inbox-queue-strip.tsx',
      'src/components/inbox/inbox-active-filters.tsx',
    ],
    plugins: { 'ui-pattern': uiPattern },
    rules: {
      'ui-pattern/strip-scroll-imports': [
        'warn',
        {
          patterns: [
            {
              group: [
                '**/strip-scroll',
                '**/use-strip-overflow',
                '**/use-reveal-current-item',
              ],
              message:
                'A scrolling row of links is a SectionNav (the sections of a place) or LinkTabs (the views of a page), which own the overflow fade, the current item in view and the hidden scrollbar.',
            },
          ],
        },
      ],
    },
  },
)
