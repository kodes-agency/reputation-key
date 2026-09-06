import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import query from '@tanstack/eslint-plugin-query'
import security from 'eslint-plugin-security'
import crossContextPublicApi from './eslint-rules/cross-context-public-api.mjs'

// BQC-5.1: local rules enforcing what eslint-plugin-boundaries cannot express.
const local = {
  rules: {
    'cross-context-public-api': crossContextPublicApi,
  },
}

// ARC-03-T3: the element types that replaced the former `shared-other`
// catch-all — every first-level `src/shared/` area without a dedicated element,
// plus the transitional root contract kernel. Outer layers name this list where
// they used to name `shared-other`, so splitting shared/ changes what shared/
// may import WITHOUT silently changing what the rest of the repository may
// import from it. Declared once in
// src/shared/architecture/shared-dependency-policy.ts and asserted equal there.
const sharedAreaElements = [
  'shared-architecture',
  'shared-bqc',
  'shared-cache',
  'shared-config',
  'shared-email',
  'shared-generated',
  'shared-google-provider-control',
  'shared-governance',
  'shared-health',
  'shared-hooks',
  'shared-http',
  'shared-jobs',
  'shared-lifecycle',
  'shared-observability',
  'shared-ops',
  'shared-outbox',
  'shared-provider-ephemeral',
  'shared-queries',
  'shared-rate-limit',
  'shared-release',
  'shared-root-contracts',
  'shared-routing',
  'shared-security',
]

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
      '**/dist-local-tools/**',
      '**/dist-google-*/**',
      '**/dist-ai-*/**',
      '**/dist-provider-services/**',
      '**/.tmp-storybook-build/**',
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
  //   shared-<area>  → shared/<area>/ — one element per first-level area
  //                    (ARC-03-T3); permitted dependencies are declared in
  //                    src/shared/architecture/shared-dependency-policy.ts
  //   shared-root-contracts → shared/*.ts (transitional contract kernel;
  //                    MUST stay the last shared-* pattern)
  //   test-helpers   → shared/testing/
  //   top-level      → worker/
  //   script-ci      → scripts/ci/, scripts/review/ (static verifiers)
  //   script-operator→ scripts/ops/ (audited admin commands)
  //   script-tooling → scripts/ (catch-all: release, perf, migrations, seeds)
  //   file categories → composition.ts, bootstrap.ts, start.ts, router.tsx,
  //                     generated/ambient files, API routes
  // ────────────────────────────────────────────────────────────────────
  {
    files: [
      'src/**/*.{ts,tsx}',
      'services/**/*.ts',
      'server/**/*.ts',
      'scripts/**/*.{ts,mjs}',
    ],
    plugins: {
      boundaries,
    },
    settings: {
      // eslint-plugin-boundaries resolves every import through this resolver;
      // without it the `#/` alias does not resolve and valid seams are rejected.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
      // Anchor every architectural element at the repository root. The v7
      // default performs suffix matching, which otherwise makes `server/**`
      // classify `src/contexts/*/server/**` as a Nitro runtime plugin.
      'boundaries/elements': rootedElements([
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
        {
          type: 'ui-support',
          pattern: 'src/hooks/**',
        },
        {
          type: 'ui-support',
          pattern: 'src/lib/**',
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
        // BQR-1.3: the durable outbox adapter subtree stays a separate element
        // so composition/worker can wire it without application reaching into
        // adapters. It MUST precede `src/shared/outbox/**` — element matching
        // is first-match-wins. Runtime root files are classified by
        // boundaries/files.
        {
          type: 'shared-outbox-infra',
          pattern: 'src/shared/outbox/infrastructure/**',
        },
        {
          type: 'test-helpers',
          pattern: 'src/shared/testing/**',
        },
        {
          type: 'test-helpers',
          pattern: 'src/test-fixtures/**',
        },
        // ARC-03-T3: one element per first-level shared area. These replaced
        // the former `shared-other` catch-all, which was allowed to import
        // itself and therefore expressed no placement rule at all. Owners and
        // permitted dependencies are documented in src/shared/CONTEXT.md and
        // declared once in src/shared/architecture/shared-dependency-policy.ts.
        {
          type: 'shared-architecture',
          pattern: 'src/shared/architecture/**',
        },
        {
          type: 'shared-bqc',
          pattern: 'src/shared/bqc/**',
        },
        {
          type: 'shared-cache',
          pattern: 'src/shared/cache/**',
        },
        {
          type: 'shared-config',
          pattern: 'src/shared/config/**',
        },
        {
          type: 'shared-email',
          pattern: 'src/shared/email/**',
        },
        {
          type: 'shared-generated',
          pattern: 'src/shared/generated/**',
        },
        {
          type: 'shared-google-provider-control',
          pattern: 'src/shared/google-provider-control/**',
        },
        {
          type: 'shared-governance',
          pattern: 'src/shared/governance/**',
        },
        {
          type: 'shared-health',
          pattern: 'src/shared/health/**',
        },
        {
          type: 'shared-hooks',
          pattern: 'src/shared/hooks/**',
        },
        {
          type: 'shared-http',
          pattern: 'src/shared/http/**',
        },
        {
          type: 'shared-jobs',
          pattern: 'src/shared/jobs/**',
        },
        {
          type: 'shared-lifecycle',
          pattern: 'src/shared/lifecycle/**',
        },
        {
          type: 'shared-observability',
          pattern: 'src/shared/observability/**',
        },
        {
          type: 'shared-ops',
          pattern: 'src/shared/ops/**',
        },
        {
          type: 'shared-outbox',
          pattern: 'src/shared/outbox/**',
        },
        {
          type: 'shared-provider-ephemeral',
          pattern: 'src/shared/provider-ephemeral/**',
        },
        {
          type: 'shared-queries',
          pattern: 'src/shared/queries/**',
        },
        {
          type: 'shared-rate-limit',
          pattern: 'src/shared/rate-limit/**',
        },
        {
          type: 'shared-release',
          pattern: 'src/shared/release/**',
        },
        {
          type: 'shared-routing',
          pattern: 'src/shared/routing/**',
        },
        {
          type: 'shared-security',
          pattern: 'src/shared/security/**',
        },
        // The transitional cross-context contract kernel that lives directly
        // in the shared root (src/shared/CONTEXT.md "Root production-file
        // categories"). `*` does not cross a path separator, so this cannot
        // swallow an area; it MUST still stay the last shared-* pattern so a
        // new area gets an element instead of falling in here.
        {
          type: 'shared-root-contracts',
          // v7 element descriptors always match FOLDERS, so this names the
          // shared root itself and therefore catches exactly the files sitting
          // directly in it — every area above has already claimed its own
          // subtree. `shared-dependency-policy.test.ts` asserts that each
          // first-level directory still has its own pattern, so a new area
          // cannot quietly land in this bucket.
          pattern: 'src/shared/**',
        },

        // ── Runtime entry points/boundaries ─────────────────────────
        // Exact root files are classified by boundaries/files below;
        // v7 element patterns describe folders, not individual files.
        {
          type: 'top-level',
          pattern: 'src/worker/**',
        },
        {
          type: 'service',
          pattern: 'services/**',
        },
        {
          type: 'runtime-plugin',
          pattern: 'server/**',
        },

        // ── Local trees outside the application graph (ARC-03-T16) ──
        // Classified so `boundaries/no-unknown` can be turned on: until every
        // local import target has an element, a module can route around the
        // whole policy set by depending on an unclassified path.
        {
          type: 'story-fixtures',
          pattern: '.storybook/**',
        },
        {
          type: 'e2e-harness',
          pattern: 'e2e/**',
        },
        {
          type: 'release-config',
          pattern: '.railway/**',
        },
        {
          type: 'test-helpers',
          pattern: 'test-fixtures/**',
        },

        // ── Repository tooling (ARC-03-T1) ──────────────────────────
        // scripts/ is a mandated negative-control category. Splitting it
        // by operational role is what makes the policies below say
        // something: a static CI verifier and an audited admin command
        // are not allowed to reach the same surfaces. Specific patterns
        // precede the catch-all — element matching is first-match-wins.
        {
          type: 'script-ci',
          pattern: 'scripts/ci/**',
        },
        {
          type: 'script-ci',
          pattern: 'scripts/review/**',
        },
        {
          type: 'script-operator',
          pattern: 'scripts/ops/**',
        },
        {
          type: 'script-tooling',
          pattern: 'scripts/**',
        },
      ]),
      // v7 file descriptors classify individual seam/runtime files without
      // pretending they are folders. These categories are consumed by the
      // dependency policies below.
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
        {
          category: 'start-entry',
          pattern: 'src/start.ts',
        },
        {
          category: 'router-entry',
          pattern: 'src/router.tsx',
        },
        {
          category: 'browser-entry',
          pattern: ['src/client.tsx', 'src/instrument.client.ts'],
        },
        {
          category: 'generated-router',
          pattern: 'src/routeTree.gen.ts',
        },
        {
          category: 'ambient-types',
          pattern: 'src/vite-env.d.ts',
        },
        {
          category: 'api-route',
          pattern: 'src/routes/api/**',
        },
        // ARC-03-T16: the worker-only wiring. `src/composition/deployables.ts`
        // builds a complete Application Container for ONE process kind; a web
        // request handler that can call it holds worker registration authority
        // and a second set of queue connections. The composition-root category
        // alone does not say that — api-route, server and the Nitro plugin are
        // all allowed to resolve the composition root.
        {
          category: 'deployable-containers',
          pattern: 'src/composition/deployables.ts',
        },
        // ARC-03-T16: browser stylesheets are local import targets too.
        {
          category: 'stylesheet',
          pattern: 'src/**/*.css',
        },
        // ARC-03-T16: story files are fixtures that wire Storybook decorators
        // and in-memory containers. Categorising them lets exactly those files
        // reach `.storybook/**` while the component they render still cannot.
        {
          category: 'story-file',
          pattern: ['src/**/*.stories.ts', 'src/**/*.stories.tsx'],
        },
        // ARC-03-T2: the shared kernel the separately deployed trust-boundary
        // sidecars are allowed to link. These processes run outside the
        // application's trust boundary, so "shared/" is not a package-level
        // dependency they inherit — this list IS the dependency boundary the
        // repository layout cannot express. It is a file category rather than
        // an element type so that reclassifying it does not change what the
        // in-process application layers may import.
        // Documented in src/shared/CONTEXT.md "Trust-boundary sidecar kernel".
        {
          category: 'shared-provider-kernel',
          pattern: [
            'src/shared/ai-*',
            'src/shared/openai-*',
            'src/shared/merchant-ai-*',
            'src/shared/closed-json-contract.ts',
            'src/shared/security/versioned-hmac-keyring.ts',
            'src/shared/observability/telemetry.ts',
          ],
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
          policies: [
            // domain → imports nothing outside domain/ and shared/domain/
            {
              from: elementType('domain'),
              allow: { to: elementType('shared-domain') },
            },

            // application → imports from domain/, shared/domain/, shared-events, shared-other (logger), application/ (cross-context public-api types)
            // Per architecture: use cases need EventBus to emit domain events (patterns #9, #22).
            // Per architecture: use cases may import logger for error resilience catch blocks.
            // Per ADR-0001: contexts may import another context's application/public-api.ts types only.
            {
              from: elementType('application'),
              allow: {
                to: elementTypes(
                  'domain',
                  'shared-domain',
                  'shared-events',
                  ...sharedAreaElements,
                  'application',
                ),
              },
            },

            // infrastructure → imports from domain/, application/, shared/*, external libs
            // Per architecture: job handlers need EventBus to emit domain events.
            // BQR-1.3: may use public outbox surface (shared-other), not relay/dispatcher.
            {
              from: elementType('infrastructure'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                ),
              },
            },

            // ARC-03-T3: the outgoing edges of shared-outbox-infra and of the
            // outbox runtime files are covered by the generated `outbox` row
            // in the shared area policy block below.

            // server → imports from domain/ (error types + type guards), application/, shared/*, TanStack Start
            // Per architecture: server functions catch tagged errors and need isXxxError type guards (pattern #16).
            // BQC-5.1: server must NOT import shared/db — DB access goes through use cases/repos.
            {
              from: elementType('server'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'shared-domain',
                  'shared-auth',
                  'shared-events',
                  ...sharedAreaElements,
                ),
              },
            },
            // Server functions are inbound adapters and resolve the already
            // assembled use-case graph through the documented container seam.
            {
              from: elementType('server'),
              allow: { to: fileCategory('composition-root') },
            },

            // context-build → the per-context wiring seam (BQC-5.1). May touch
            // every layer of its OWN context + shared; the local
            // cross-context-public-api rule narrows foreign-context imports to
            // public-api surfaces.
            {
              from: fileCategory('context-build'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'infrastructure',
                  'server',
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                ),
              },
            },
            {
              from: fileCategory('context-build'),
              allow: { to: fileCategory('context-build') },
            },

            // context-ui → pure view helpers (e.g. goal/ui) consumed by routes
            // and components; reads application DTOs + shared types only.
            {
              from: elementType('context-ui'),
              allow: {
                to: elementTypes('application', 'shared-domain', ...sharedAreaElements),
              },
            },

            // routes → imports from server/, application/dto/ (form schemas), components/, shared/*
            //   Per conventions: routes need DTO types for mutation variable types.
            //   BQC-5.1: routes must NOT import shared/db (health probes use shared/health seams).
            {
              from: elementType('routes'),
              allow: {
                to: elementTypes(
                  'server',
                  'application',
                  'components',
                  'context-ui',
                  'shared-domain',
                  'shared-auth',
                  ...sharedAreaElements,
                  'ui-support',
                ),
              },
            },

            // components → imports from other components/, shared/*, application/, server/ (TanStack server functions)
            // Per conventions: components call server functions via useServerFn
            {
              from: elementType('components'),
              allow: {
                to: elementTypes(
                  'components',
                  'context-ui',
                  'shared-domain',
                  'shared-auth',
                  ...sharedAreaElements,
                  'application',
                  'server',
                  'ui-support',
                ),
              },
            },

            // Shared browser helpers may compose one another and consume only
            // shared contracts. They are not an alternate route into context
            // server/application or database modules.
            {
              from: elementType('ui-support'),
              allow: {
                to: elementTypes('ui-support', 'shared-domain', ...sharedAreaElements),
              },
            },

            // ── Shared area placement rules (ARC-03-T3) ───────────────
            // GENERATED from SHARED_DEPENDENCY_POLICY in
            // src/shared/architecture/shared-dependency-policy.ts and asserted
            // byte-identical by shared-context-ownership.test.ts. Do not hand
            // edit: change the table (and its CONTEXT.md column) instead.
            // shared-dependency-policy:start
            {
              from: elementType('shared-architecture'),
              allow: { to: elementType('shared-architecture') },
            },
            {
              from: elementType('shared-auth'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-cache',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-email',
                  'shared-google-provider-control',
                  'shared-governance',
                  'shared-observability',
                  'shared-routing',
                ),
              },
            },
            {
              from: elementType('shared-bqc'),
              allow: { to: elementType('shared-bqc') },
            },
            {
              from: elementType('shared-cache'),
              allow: {
                to: elementTypes('shared-cache', 'shared-config', 'shared-observability'),
              },
            },
            {
              from: elementType('shared-config'),
              allow: {
                to: elementTypes('shared-auth', 'shared-config', 'shared-domain'),
              },
            },
            {
              from: elementType('shared-db'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-governance',
                  'shared-observability',
                  'shared-ops',
                  'shared-outbox',
                  'shared-release',
                ),
              },
            },
            {
              from: elementType('shared-domain'),
              allow: { to: elementType('shared-domain') },
            },
            {
              from: elementType('shared-email'),
              allow: { to: elementType('shared-email') },
            },
            {
              from: elementType('shared-events'),
              allow: { to: elementTypes('shared-events', 'shared-observability') },
            },
            {
              from: elementType('shared-generated'),
              allow: { to: elementType('shared-generated') },
            },
            {
              from: elementType('shared-google-provider-control'),
              allow: {
                to: elementTypes(
                  'shared-domain',
                  'shared-google-provider-control',
                  'shared-security',
                ),
              },
            },
            {
              from: elementType('shared-governance'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-db',
                  'shared-domain',
                  'shared-governance',
                ),
              },
            },
            {
              from: elementType('shared-health'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-cache',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-health',
                  'shared-jobs',
                  'shared-observability',
                  'shared-outbox',
                ),
              },
            },
            {
              from: elementType('shared-hooks'),
              allow: { to: elementTypes('shared-auth', 'shared-domain', 'shared-hooks') },
            },
            {
              from: elementType('shared-http'),
              allow: { to: elementType('shared-http') },
            },
            {
              from: elementType('shared-jobs'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-events',
                  'shared-governance',
                  'shared-health',
                  'shared-jobs',
                  'shared-observability',
                  'shared-outbox',
                  'shared-routing',
                ),
              },
            },
            {
              from: elementType('shared-lifecycle'),
              allow: { to: elementType('shared-lifecycle') },
            },
            {
              from: elementType('shared-observability'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-health',
                  'shared-jobs',
                  'shared-observability',
                  'shared-outbox',
                ),
              },
            },
            {
              from: elementType('shared-ops'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-ops',
                  'shared-outbox',
                ),
              },
            },
            {
              from: elementTypes('shared-outbox', 'shared-outbox-infra'),
              allow: {
                to: elementTypes(
                  'shared-db',
                  'shared-domain',
                  'shared-events',
                  'shared-governance',
                  'shared-jobs',
                  'shared-observability',
                  'shared-outbox',
                  'shared-outbox-infra',
                ),
              },
            },
            {
              from: elementType('shared-provider-ephemeral'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-domain',
                  'shared-provider-ephemeral',
                  'shared-security',
                ),
              },
            },
            {
              from: elementType('shared-queries'),
              allow: { to: elementType('shared-queries') },
            },
            {
              from: elementType('shared-rate-limit'),
              allow: { to: elementTypes('shared-observability', 'shared-rate-limit') },
            },
            {
              from: elementType('shared-release'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-db',
                  'shared-domain',
                  'shared-governance',
                  'shared-release',
                ),
              },
            },
            {
              from: elementType('shared-routing'),
              allow: {
                to: elementTypes('shared-domain', 'shared-routing', 'shared-security'),
              },
            },
            {
              from: elementType('shared-security'),
              allow: {
                to: elementTypes(
                  'shared-config',
                  'shared-domain',
                  'shared-observability',
                  'shared-security',
                ),
              },
            },
            {
              from: elementType('test-helpers'),
              allow: {
                to: elementTypes(
                  'shared-auth',
                  'shared-bqc',
                  'shared-config',
                  'shared-db',
                  'shared-domain',
                  'shared-events',
                  'shared-health',
                  'shared-jobs',
                  'shared-observability',
                  'test-helpers',
                ),
              },
            },
            // shared-dependency-policy:end

            // Edges the per-area table cannot express, because their targets
            // are not shared areas.
            //
            // The shared root holds a transitional cross-context contract
            // kernel (src/shared/CONTEXT.md "Root production-file categories").
            // Only the areas that actually read it may — a new reader is a
            // placement question, not a lint fix.
            {
              from: elementTypes(
                'shared-db',
                'shared-governance',
                'shared-observability',
                'shared-ops',
                'test-helpers',
              ),
              allow: { to: elementType('shared-root-contracts') },
            },
            {
              from: elementType('shared-root-contracts'),
              allow: {
                to: elementTypes(
                  'shared-domain',
                  'shared-generated',
                  'shared-google-provider-control',
                  'shared-root-contracts',
                  'shared-security',
                ),
              },
            },

            // shared-events → the master union imports each context's
            // domain/events module. Per architecture: "Cross-context type
            // imports are allowed for events."
            {
              from: elementType('shared-events'),
              allow: { to: elementType('domain') },
            },

            // test-helpers → in-memory fakes implement context port interfaces
            // (pattern #18) and integration harnesses build the container.
            {
              from: elementType('test-helpers'),
              allow: { to: elementTypes('domain', 'application') },
            },
            {
              from: elementType('test-helpers'),
              allow: { to: fileCategory('composition-root') },
            },

            // Worker entry points consume the assembled runtime graph plus
            // infrastructure-owned job adapters and shared runtime services.
            {
              from: elementType('top-level'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'infrastructure',
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                  // BQR-1.3: composition/worker construct outbox adapters and loops
                  'shared-outbox-infra',
                ),
              },
            },
            {
              from: elementType('top-level'),
              allow: { to: fileCategory('composition-root') },
            },

            // eslint-plugin-boundaries v7 classifies exact root files through
            // file categories. The composition/bootstrap pair may wire
            // contexts and runtime infrastructure, but must never reach into
            // UI/routes. Context build targets are categories as well.
            {
              from: fileCategory('composition-root'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'infrastructure',
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                  'shared-outbox-infra',
                  'service',
                ),
              },
            },
            {
              from: fileCategory('composition-root'),
              allow: {
                to: fileCategory(['composition-root', 'context-build']),
              },
            },
            {
              from: fileCategory('start-entry'),
              allow: {
                to: elementTypes(
                  'server',
                  'shared-domain',
                  'shared-auth',
                  ...sharedAreaElements,
                ),
              },
            },
            {
              from: fileCategory('router-entry'),
              allow: {
                to: elementTypes(
                  'components',
                  'ui-support',
                  'shared-domain',
                  ...sharedAreaElements,
                ),
              },
            },
            {
              from: fileCategory('router-entry'),
              allow: { to: fileCategory('generated-router') },
            },
            {
              from: fileCategory('browser-entry'),
              allow: { to: fileCategory('browser-entry') },
            },
            {
              from: fileCategory('browser-entry'),
              allow: { to: elementType('shared-observability') },
            },
            // HTTP API routes host non-createServerFn callbacks (auth,
            // health, provider webhooks) and may resolve root-owned runtime
            // capabilities. Browser route modules receive no such exception.
            {
              from: fileCategory('api-route'),
              allow: { to: fileCategory('composition-root') },
            },

            // ARC-03-T2: the trust-boundary sidecars are separately deployed
            // processes. They may link service-local modules and the NAMED
            // shared-provider-kernel category — nothing else. Blanket
            // shared-auth/shared-db/shared-other access is what let an
            // out-of-boundary process reach the application database, the
            // better-auth kernel and the job queue with no package-level
            // dependency boundary to stop it.
            {
              from: elementType('service'),
              allow: { to: elementType('service') },
            },
            {
              from: elementType('service'),
              allow: { to: fileCategory('shared-provider-kernel') },
            },
            {
              from: elementType('runtime-plugin'),
              allow: {
                to: elementTypes(
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                ),
              },
            },
            {
              from: elementType('runtime-plugin'),
              allow: { to: fileCategory('composition-root') },
            },

            // ── Repository tooling (ARC-03-T1) ────────────────────────
            // CI verifiers are static: they read published catalogues and
            // cross-context public APIs. They never open a database
            // connection, never touch an adapter, and never resolve the
            // runtime container — a check that boots the app is not a
            // check, it is a deployment.
            {
              from: elementType('script-ci'),
              allow: {
                to: elementTypes(
                  'application',
                  'domain',
                  'shared-domain',
                  ...sharedAreaElements,
                  'test-helpers',
                ),
              },
            },

            // Operator commands are audited in-process admin entry points.
            // They resolve the composition root and the per-context build
            // seams, and — like the worker — construct the adapters they
            // drive. They must never reach a context's HTTP/server layer
            // (that is an inbound adapter for browsers, not for a CLI) nor
            // any browser element.
            {
              from: elementType('script-operator'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'infrastructure',
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                  'shared-outbox-infra',
                  'test-helpers',
                ),
              },
            },
            {
              from: elementType('script-operator'),
              allow: {
                to: fileCategory(['composition-root', 'context-build']),
              },
            },

            // Build/seed/migration tooling wires the same runtime graph as
            // the worker. Same ceiling as the operator commands, same
            // browser and server-adapter floor.
            {
              from: elementType('script-tooling'),
              allow: {
                to: elementTypes(
                  'domain',
                  'application',
                  'infrastructure',
                  'shared-domain',
                  'shared-auth',
                  'shared-db',
                  'shared-events',
                  ...sharedAreaElements,
                  'shared-outbox-infra',
                  'test-helpers',
                  'script-operator',
                  'service',
                ),
              },
            },
            {
              from: elementType('script-tooling'),
              allow: {
                to: fileCategory(['composition-root', 'context-build']),
              },
            },

            // File-category policies preserve the former single-file element
            // semantics after the v7 migration. Because the runtime files now
            // also belong to the shared-outbox element, the final policies
            // deliberately narrow both incoming and outgoing runtime
            // dependencies.
            {
              disallow: { to: fileCategory('shared-outbox-runtime') },
            },
            // ARC-03-T3: only the outbox area's own commit/emit helpers reach
            // the relay — this was `shared-other`, i.e. all of shared/.
            {
              from: elementType('shared-outbox'),
              allow: { to: fileCategory('shared-outbox-runtime') },
            },
            {
              from: elementType('top-level'),
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
                  'shared-db',
                  'shared-domain',
                  'shared-events',
                  'shared-governance',
                  'shared-jobs',
                  'shared-observability',
                  'shared-outbox',
                  'shared-outbox-infra',
                ),
              },
            },
            {
              from: fileCategory('shared-outbox-runtime'),
              disallow: { to: fileCategory('shared-outbox-runtime') },
            },

            // ── Per-deployable container wiring (ARC-03-T16) ──────────
            // Default-disallow already covers most callers, but api-route,
            // server, the Nitro plugin and operator scripts are all allowed to
            // resolve the composition root — and the worker container builder
            // lives inside it. Deny it globally and re-open it only for the
            // process entry points and the fixtures that assert the partition:
            // the worker bootstrap, the operator CLI harness (one process, one
            // operator container, then shutdown), and the process fixtures.
            // Callers that only need the narrowed container TYPES import
            // `src/composition/container-partition.ts`, which cannot build one.
            {
              disallow: { to: fileCategory('deployable-containers') },
            },
            {
              from: elementTypes('top-level', 'test-helpers'),
              allow: { to: fileCategory('deployable-containers') },
            },
            {
              from: elementType('script-operator'),
              allow: { to: fileCategory('deployable-containers') },
            },

            // Browser layers may link a stylesheet; nothing else may.
            {
              from: elementTypes('routes', 'components', 'router-entry'),
              allow: { to: fileCategory('stylesheet') },
            },

            // Only a story file may reach the Storybook harness. The component
            // it renders keeps its ordinary policy, so decorators and
            // in-memory containers cannot reach a production bundle.
            {
              from: fileCategory('story-file'),
              allow: { to: elementType('story-fixtures') },
            },

            // Repository tooling drives the local end-to-end stubs and reads
            // the Railway deployment source map (ARC-03-T16). Neither is part
            // of the application graph, and no src/ element may reach them.
            {
              from: elementType('script-tooling'),
              allow: { to: elementTypes('e2e-harness', 'release-config') },
            },
          ],
        },
      ],

      // Every production src/service/plugin file must be classified. Test
      // files are disabled in the dedicated override below.
      'boundaries/no-unknown-files': 'error',

      // ARC-03-T16: the other half of classification. no-unknown-files proves
      // the file being linted has an element; this proves the files it IMPORTS
      // do. Without it a module can route around every policy above by
      // depending on a local path that matches no element at all.
      // `boundaries/no-unknown` is the same rule under its pre-v7 name; using
      // it prints a deprecation warning on every lint run, so the canonical id
      // is enabled here and the control runner accepts either.
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
      'services/**/*.test.ts',
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
  // A test must import the unit it covers, so the dependency policy is
  // relaxed exactly as it is for src/ and services/ tests. Classification
  // is NOT relaxed: boundaries/no-unknown-files stays on for every file
  // under scripts/, tests included — an unclassified script would silently
  // escape the policy above, which is the failure mode this task exists to
  // close.
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
      // Max file length to prevent monolith components. 300, because 200 was
      // being satisfied by splitting a page into sub-components that had one
      // caller and no independent meaning — fragmentation that reads as
      // structure. A page past 300 counted lines is genuinely doing too much.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
)
