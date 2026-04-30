import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/dist-worker/**',
      '**/drizzle/**',
      '**/node_modules/**',
      '**/.a5c/**',
      '**/.agents/**',
      'src/routeTree.gen.ts',
    ],
  },

  // ─── Architectural boundary enforcement ────────────────────────────
  // Mechanically enforces every rule from docs/conventions.md
  // "Dependency rules (enforced by lint)"
  //
  // Element types map to our folder structure:
  //   domain         → contexts/<name>/domain/
  //   application    → contexts/<name>/application/
  //   infrastructure → contexts/<name>/infrastructure/
  //   server         → contexts/<name>/server/
  //   routes         → routes/
  //   components     → components/
  //   shared-domain  → shared/domain/
  //   shared-auth    → shared/auth/
  //   shared-db      → shared/db/ (schema barrel, drizzle client — allowed to use drizzle-orm)
  //   shared-other   → shared/ (cache, config, fn, health, jobs, observability, rate-limit)
  //   test-helpers   → shared/testing/
  //   top-level      → composition.ts, bootstrap.ts, start.ts, router.tsx, worker/
  // ────────────────────────────────────────────────────────────────────
  {
    plugins: {
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
      'boundaries/elements': [
        // ── Context layers (inner → outer) ──────────────────────────
        {
          type: 'domain',
          pattern: 'src/contexts/*/domain/**',
        },
        {
          type: 'application',
          pattern: 'src/contexts/*/application/**',
        },
        {
          type: 'infrastructure',
          pattern: 'src/contexts/*/infrastructure/**',
        },
        {
          type: 'server',
          pattern: 'src/contexts/*/server/**',
        },

        // ── Route & UI layers ───────────────────────────────────────
        {
          type: 'routes',
          pattern: 'src/routes/**',
        },
        {
          type: 'components',
          pattern: 'src/components/**',
        },

        // ── Shared layers ───────────────────────────────────────────
        {
          type: 'shared-domain',
          pattern: 'src/shared/domain/**',
        },
        {
          type: 'shared-auth',
          pattern: 'src/shared/auth/**',
        },
        {
          type: 'shared-db',
          pattern: 'src/shared/db/**',
        },
        {
          type: 'shared-events',
          pattern: 'src/shared/events/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/cache/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/config/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/fn/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/health/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/jobs/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/observability/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/rate-limit/**',
        },
        {
          type: 'test-helpers',
          pattern: 'src/shared/testing/**',
        },

        // ── Top-level entry points ──────────────────────────────────
        {
          type: 'top-level',
          pattern: 'src/composition.*',
        },
        {
          type: 'top-level',
          pattern: 'src/bootstrap.*',
        },
        {
          type: 'top-level',
          pattern: 'src/start.*',
        },
        {
          type: 'top-level',
          pattern: 'src/router.*',
        },
        {
          type: 'top-level',
          pattern: 'src/worker/**',
        },
      ],
    },
    rules: {
      // ── Boundary dependency rules ─────────────────────────────────
      // Default: disallow everything, then explicitly allow per-layer.
      // This is the mechanical backstop from conventions.md.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            'Architectural boundary violated. See docs/conventions.md "Dependency rules".',
          rules: [
            // domain → imports nothing outside domain/ and shared/domain/
            {
              from: { type: 'domain' },
              allow: { to: { type: 'shared-domain' } },
            },

            // application → imports from domain/, shared/domain/, shared-events, application/ (cross-context public-api types)
            // Per architecture: use cases need EventBus to emit domain events (patterns #9, #22).
            // Per ADR-0001: contexts may import another context's application/public-api.ts types only.
            {
              from: { type: 'application' },
              allow: {
                to: {
                  type: ['domain', 'shared-domain', 'shared-events', 'application'],
                },
              },
            },

            // infrastructure → imports from domain/, application/, shared/*, external libs
            {
              from: { type: 'infrastructure' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'application',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-other',
                  ],
                },
              },
            },

            // server → imports from domain/ (error types + type guards), application/, shared/*, TanStack Start
            // Per architecture: server functions catch tagged errors and need isXxxError type guards (pattern #16).
            {
              from: { type: 'server' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'application',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-events',
                    'shared-other',
                  ],
                },
              },
            },

            // routes → imports from server/, application/dto/ (form schemas), components/, shared/*
            //   Per conventions: routes need DTO types for mutation variable types.
            {
              from: { type: 'routes' },
              allow: {
                to: {
                  type: [
                    'server',
                    'application',
                    'components',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-other',
                  ],
                },
              },
            },

            // components → imports from other components/, shared/*, application/dto/ (form schemas only)
            // Per conventions: "components/ imports from ... contexts/<ctx>/application/dto/ (for form schemas only)"
            {
              from: { type: 'components' },
              allow: {
                to: {
                  type: [
                    'components',
                    'shared-domain',
                    'shared-auth',
                    'shared-other',
                    'application',
                  ],
                },
              },
            },

            // shared-domain → pure, imports from itself and external libs only
            {
              from: { type: 'shared-domain' },
              allow: { to: { type: 'shared-domain' } },
            },

            // shared-auth → imports from shared/ and external libs
            {
              from: { type: 'shared-auth' },
              allow: {
                to: { type: ['shared-domain', 'shared-db', 'shared-other'] },
              },
            },

            // shared-db → imports from shared/ and external libs (including drizzle-orm)
            {
              from: { type: 'shared-db' },
              allow: {
                to: { type: ['shared-domain', 'shared-auth', 'shared-other'] },
              },
            },

            // shared-events → imports from shared/ + context domain (event types only)
            // Per architecture: "Cross-context type imports are allowed for events."
            {
              from: { type: 'shared-events' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-other',
                  ],
                },
              },
            },

            // shared-other → imports from shared/ and external libs only
            {
              from: { type: 'shared-other' },
              allow: {
                to: {
                  type: ['shared-domain', 'shared-auth', 'shared-db', 'shared-other'],
                },
              },
            },

            // test-helpers → may import domain, application (port interfaces), shared for building fixtures
            // Per architecture: in-memory fakes implement context port interfaces (pattern #18).
            {
              from: { type: 'test-helpers' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'application',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-events',
                    'shared-other',
                  ],
                },
              },
            },

            // top-level → imports from infrastructure (wiring), shared/* (wiring everything together)
            // Per architecture: composition.ts wires the full dependency graph, including infrastructure factories.
            {
              from: { type: 'top-level' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'application',
                    'infrastructure',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-events',
                    'shared-other',
                  ],
                },
              },
            },
          ],
        },
      ],

      // Off — too noisy for now. Files without an element type still
      // get caught by the dependency rules if they import wrong things.
      'boundaries/no-unknown-files': 'off',
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

  // ─── Allow React in permitted locations ────────────────────────────
  {
    files: [
      'src/routes/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/integrations/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ─── Test files: relaxed boundary rules ────────────────────────────
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-setup.ts'],
    rules: {
      'boundaries/dependencies': 'off',
      'no-restricted-imports': 'off',
    },
  },
)
