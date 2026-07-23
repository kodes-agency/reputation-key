import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import crossContextPublicApi from './eslint-rules/cross-context-public-api.mjs'

// BQC-5.1: local rules enforcing what eslint-plugin-boundaries cannot express.
const local = {
  rules: {
    'cross-context-public-api': crossContextPublicApi,
  },
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
      'scripts/**',
      'deacon/**',
      'reputation_key/**',
    ],
  },

  // ─── Architectural boundary enforcement ────────────────────────────
  // Mechanically enforces the dependency rules from src/contexts/CONTEXT.md
  // ("Dependency rules"), together with the local cross-context-public-api
  // rule (registered further below).
  //
  // Element types map to our folder structure:
  //   domain         → contexts/<name>/domain/
  //   application    → contexts/<name>/application/ (+ legacy root ports/, queries/)
  //   infrastructure → contexts/<name>/infrastructure/
  //   server         → contexts/<name>/server/
  //   context-build  → contexts/<name>/build.ts, build-*.ts (per-context wiring seam)
  //   context-ui     → contexts/<name>/ui/ (pure view helpers for routes/components)
  //   routes         → routes/
  //   components     → components/
  //   shared-domain  → shared/domain/
  //   shared-auth    → shared/auth/
  //   shared-db      → shared/db/ (schema barrel, drizzle client — allowed to use drizzle-orm)
  //   shared-events  → shared/events/ (event bus + master union)
  //   shared-other   → shared/ (cache, config, fn, health, jobs, observability, rate-limit,
  //                    routing, security, queries, ... — catch-all for dirs without a
  //                    dedicated element; MUST stay the last shared-* pattern)
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
        // BQC-5.1: per-context build files are the wiring seam — they may
        // touch every layer of their OWN context + shared. Cross-context
        // narrowing (public-api only) comes from the local rule.
        {
          type: 'context-build',
          pattern: 'src/contexts/*/build.ts',
        },
        {
          type: 'context-build',
          pattern: 'src/contexts/*/build-*.ts',
        },
        // BQC-5.1: the activity context keeps root-level ports/ and queries/
        // dirs — they ARE application concerns; classifying them enforces the
        // rules. BQC-5.2 owns the physical layout alignment.
        {
          type: 'application',
          pattern: 'src/contexts/*/ports/**',
        },
        {
          type: 'application',
          pattern: 'src/contexts/*/queries/**',
        },
        {
          type: 'context-ui',
          pattern: 'src/contexts/*/ui/**',
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
          type: 'shared-other',
          pattern: 'src/shared/routing/**',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/security/**',
        },
        // BQR-1.3: public outbox surface is shared-other (application-allowed).
        // Infrastructure implementation is a separate element so composition/worker
        // can wire it without application reaching into adapters.
        {
          type: 'shared-other',
          pattern: 'src/shared/outbox/index.ts',
        },
        {
          type: 'shared-other',
          pattern: 'src/shared/outbox/emit-and-record.ts',
        },
        {
          type: 'shared-outbox-infra',
          pattern: 'src/shared/outbox/infrastructure/**',
        },
        {
          type: 'shared-outbox-runtime',
          pattern: 'src/shared/outbox/relay.ts',
        },
        {
          type: 'shared-outbox-runtime',
          pattern: 'src/shared/outbox/dispatcher.ts',
        },
        {
          type: 'shared-outbox-runtime',
          pattern: 'src/shared/outbox/event-adapter.ts',
        },
        {
          type: 'test-helpers',
          pattern: 'src/shared/testing/**',
        },
        // BQC-5.1: catch-all for shared/ dirs without a dedicated element
        // (queries, architecture, ...). MUST stay the last shared-* pattern —
        // element matching is first-match-wins, so the specific patterns
        // above keep their types.
        {
          type: 'shared-other',
          pattern: 'src/shared/**',
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
            'Architectural boundary violated. See src/contexts/CONTEXT.md "Dependency rules".',
          rules: [
            // domain → imports nothing outside domain/ and shared/domain/
            {
              from: { type: 'domain' },
              allow: { to: { type: 'shared-domain' } },
            },

            // application → imports from domain/, shared/domain/, shared-events, shared-other (logger), application/ (cross-context public-api types)
            // Per architecture: use cases need EventBus to emit domain events (patterns #9, #22).
            // Per architecture: use cases may import logger for error resilience catch blocks.
            // Per ADR-0001: contexts may import another context's application/public-api.ts types only.
            {
              from: { type: 'application' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'shared-domain',
                    'shared-events',
                    'shared-other',
                    'application',
                  ],
                },
              },
            },

            // infrastructure → imports from domain/, application/, shared/*, external libs
            // Per architecture: job handlers need EventBus to emit domain events.
            // BQR-1.3: may use public outbox surface (shared-other), not relay/dispatcher.
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
                    'shared-events',
                    'shared-other',
                  ],
                },
              },
            },

            // shared outbox infrastructure may use shared-db / observability (via shared-other)
            {
              from: { type: 'shared-outbox-infra' },
              allow: {
                to: {
                  type: ['shared-db', 'shared-other', 'shared-domain', 'shared-events'],
                },
              },
            },
            {
              from: { type: 'shared-outbox-runtime' },
              allow: {
                to: {
                  type: [
                    'shared-outbox-infra',
                    'shared-other',
                    'shared-db',
                    'shared-domain',
                    'shared-events',
                  ],
                },
              },
            },

            // server → imports from domain/ (error types + type guards), application/, shared/*, TanStack Start
            // Per architecture: server functions catch tagged errors and need isXxxError type guards (pattern #16).
            // BQC-5.1: server must NOT import shared/db — DB access goes through use cases/repos.
            {
              from: { type: 'server' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'application',
                    'shared-domain',
                    'shared-auth',
                    'shared-events',
                    'shared-other',
                  ],
                },
              },
            },

            // context-build → the per-context wiring seam (BQC-5.1). May touch
            // every layer of its OWN context + shared; the local
            // cross-context-public-api rule narrows foreign-context imports to
            // public-api surfaces.
            {
              from: { type: 'context-build' },
              allow: {
                to: {
                  type: [
                    'domain',
                    'application',
                    'infrastructure',
                    'server',
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-events',
                    'shared-other',
                  ],
                },
              },
            },

            // context-ui → pure view helpers (e.g. goal/ui) consumed by routes
            // and components; reads application DTOs + shared types only.
            {
              from: { type: 'context-ui' },
              allow: {
                to: { type: ['application', 'shared-domain', 'shared-other'] },
              },
            },

            // routes → imports from server/, application/dto/ (form schemas), components/, shared/*
            //   Per conventions: routes need DTO types for mutation variable types.
            //   BQC-5.1: routes must NOT import shared/db (health probes use shared/health seams).
            {
              from: { type: 'routes' },
              allow: {
                to: {
                  type: [
                    'server',
                    'application',
                    'components',
                    'context-ui',
                    'shared-domain',
                    'shared-auth',
                    'shared-other',
                  ],
                },
              },
            },

            // components → imports from other components/, shared/*, application/, server/ (TanStack server functions)
            // Per conventions: components call server functions via useServerFn
            {
              from: { type: 'components' },
              allow: {
                to: {
                  type: [
                    'components',
                    'context-ui',
                    'shared-domain',
                    'shared-auth',
                    'shared-other',
                    'application',
                    'server',
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
            // BQR-1.3: emit-and-record (shared-other) may depend on outbox infra + adapter
            {
              from: { type: 'shared-other' },
              allow: {
                to: {
                  type: [
                    'shared-domain',
                    'shared-auth',
                    'shared-db',
                    'shared-other',
                    'shared-outbox-infra',
                    'shared-outbox-runtime',
                    'shared-events',
                  ],
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
                    // BQR-1.3: composition/worker construct outbox adapters and loops
                    'shared-outbox-infra',
                    'shared-outbox-runtime',
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
  {
    files: ['src/shared/observability/health-metrics.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // ─── Allow React in permitted locations ────────────────────────────
  // Re-enables no-restricted-imports for React, but keeps the barrel-only rule.
  {
    files: ['src/routes/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
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
  // context's domain/events module — CONTEXT.md: "Cross-context type imports
  // allowed for events only." Every other domain path is rejected.
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
              ],
              message:
                'shared/events may only import context domain/events modules (the master union). Other domain imports belong in the context itself.',
            },
          ],
        },
      ],
    },
  },

  // ─── Test files: relaxed boundary rules ────────────────────────────
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-setup.ts'],
    rules: {
      'boundaries/dependencies': 'off',
      'no-restricted-imports': 'off',
      'local/cross-context-public-api': 'off',
    },
  },

  // ─── Component file length enforcement ─────────────────────────────
  // shadcn/ui primitives are auto-generated and not subject to our limits.
  // Files exceeding 150 lines are exempt until their feature is restructured
  // (Phase 2-4). New files and restructured files must comply.
  {
    ignores: [
      'src/components/ui/**',
      'src/components/features/identity/member-directory/invite-member-form.tsx',
      'src/components/features/identity/member-directory/member-table.tsx',
      'src/components/features/organization/organization-settings-form.tsx',
      'src/components/features/portal/portal-form/edit-portal-form.tsx',
      'src/components/features/portal/link-tree/link-tree.tsx',
      'src/components/features/portal/link-tree/sortable-category.tsx',
      'src/components/features/staff/assign-staff-form.tsx',
      'src/components/features/team/team-members/team-member-list.tsx',
      'src/components/layout/manager-sidebar.tsx',
      'src/components/layout/staff-sidebar.tsx',
      // Story files are fixtures (many variants), not components — not subject to the monolith limit.
      'src/**/*.stories.tsx',
      'src/**/*.stories.ts',
    ],
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      // Max file length to prevent monolith components. 200 (not 150): JSX is
      // verbose, and normal list/dashboard pages legitimately run 150–190 lines.
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },
)
