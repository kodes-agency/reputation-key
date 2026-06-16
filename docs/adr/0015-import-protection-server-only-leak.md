# ADR 0015: TanStack Start Import Protection — Server-Only Code Leak

**Status:** Accepted
**Date:** 2026-06-15
**Context:** Dev tooling, Vite config, TanStack Start, hydration

## Context

Symptom: pages render server-side (SSR returns 200) but **no interactive element works** — buttons, inputs, and links are dead. The client never hydrates. This is the same observable failure as [ADR 0012](./0012-nitro-dev-mode-exclusion.md) ("pages load but nothing works"), but with a different root cause.

### Root cause

Server-only modules that use Node builtins or server-only packages (`node:async_hooks`, `node:crypto`, `pg`, `ioredis`, `bullmq`, the better-auth server instance, the composition root) were **leaking into the client bundle** and executing in the browser. Vite externalizes Node builtins for the browser; accessing them throws (`Module "X" has been externalized for browser compatibility`), which kills the client entry before React can hydrate.

The leak happened through two paths:

1. **Barrel value-imports.** A server module (`contexts/guest/server/guest-scans.ts`) exported both `createServerFn` server functions **and** plain helpers (`hashIp`, which uses `node:crypto`). The barrel `public.ts` value-imported those helpers. TanStack Start RPC-stubs the `createServerFn` handler bodies for the client, but it does **not** strip module-level `import { createHash } from 'crypto'` — so loading the barrel for `getPublicPortal` dragged `crypto` into the browser.

2. **API routes in the route tree.** `routeTree.gen.ts` statically imports the `routes/api/*` modules, which import `getAuth`/`getDb`/`getContainer` → `composition.ts` → `pg`. API routes are not `createServerFn`, so they are not RPC-stubbed and leak wholesale.

TanStack Start ships **Import Protection** (enabled by default) that prevents exactly this — but it only matches `*.server.*` file names and the `@tanstack/react-start/server` specifier by default. This codebase uses a `server/` **directory** convention and un-suffixed shared modules, so the default rules did not catch them.

## Decision

Enable TanStack Start's `importProtection` with explicit `client.files` deny rules covering the server-only modules and directories:

```ts
tanstackStart({
  importProtection: {
    client: {
      files: [
        '**/*.server.*',
        '**/routes/api/**',
        '**/composition.ts',
        '**/infrastructure/**',
        '**/build.ts',
        '**/shared/db/**',
        '**/shared/cache/**',
        '**/shared/jobs/**',
        '**/shared/observability/**',
        '**/shared/auth/auth.ts',
        '**/shared/auth/middleware.ts',
        '**/shared/auth/server-errors.ts',
        '**/shared/auth/headers.ts',
      ],
    },
  },
})
```

In dev, violations are **mocked** (recursive Proxy) — the build continues and hydration works. In production builds, violations **error** — forcing the leak to be fixed before deploy.

Server-function modules (`src/contexts/*/server/**`) are **deliberately not denied**: TanStack RPC-stubs them for the client and that transform strips their server-only imports, so denying them would only replace the RPC stubs with mocks and break remote calls.

Additionally, the one helper that mixes a Node builtin with a plain export (`hashIp`) was extracted into `hash-ip.server.ts` so the `*.server.*` convention covers it explicitly, and `request-context.ts` carries the `'@tanstack/react-start/server-only'` marker as a file-level declaration.

## Consequences

**Positive:**

- Dev-server hydration works; all interactive elements are live.
- The leak class is caught automatically going forward — any new server-only module imported by client code is mocked (dev) or fails the build (prod).
- Production builds fail loudly on leaks instead of shipping broken hydration.

**Negative:**

- A mocked server-only import in dev returns a recursive Proxy; calling it client-side silently no-ops rather than erroring. This is acceptable because such calls only happen through server functions (which are RPC-stubbed, not mocked).
- New server-only directories added under `src/` must be added to the deny list or follow the `*.server.*` naming convention.

**Validation:** After any change to the Vite config or server/client boundary, verify in dev that (a) the browser console shows no `externalized for browser compatibility` errors, (b) `document.querySelector('button')` has `__reactProps*` keys (hydrated), and (c) a known server function (e.g. `auth.getSession`) completes in the server log.

## Related

- [ADR 0012 — Nitro Dev-Mode Exclusion](./0012-nitro-dev-mode-exclusion.md) (same symptom, different cause)
- TanStack Start docs → "Import Protection"
