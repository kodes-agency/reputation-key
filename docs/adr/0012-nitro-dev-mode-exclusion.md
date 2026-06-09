# ADR 0012: Nitro Vite Plugin — Dev-Mode Exclusion

**Status:** Accepted
**Date:** 2025-06-09
**Context:** Dev tooling, Vite config, TanStack Start

## Context

The project uses `nitro()` as a Vite plugin to externalize Sentry packages during production builds (`rollupConfig: { external: [/^@sentry\//] }`). Nitro was loaded unconditionally in all modes (dev + build).

During development, Nitro 3 beta creates a custom Vite SSR environment and adds a `dispatchFetch` method to it. TanStack Start's Vite dev server plugin detects this via `"dispatchFetch" in serverEnv` and **skips installing its own middleware** — it assumes the environment already has a fetch handler.

Without TanStack's middleware:

- `/_serverFn/*` routes fall through to Nitro's catch-all → returns HTML 404
- Client hydration never initializes (no router state injected)
- Pages render server-side but are non-interactive

This manifested as "pages load but nothing works" — a subtle failure that looks like a CSS/layout issue but is actually a complete hydration failure.

## Decision

Load the `nitro()` Vite plugin **only during production builds** (`mode === 'production'`). During dev mode, omit it entirely.

```ts
const isBuild = mode === 'production'
return {
  plugins: [
    devtools(),
    ...(isBuild ? [nitro({ rollupConfig: { external: [/^@sentry\//] } })] : []),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}
```

## Consequences

**Positive:**

- Dev server hydration works correctly
- Server function routing returns JSON as expected
- Production builds still get Sentry externalization via Nitro

**Negative:**

- Sentry packages are bundled in dev mode (acceptable — dev only)
- Future Vite plugins that modify the SSR environment must be validated against TanStack Start's guard

**Validation:** After any Vite config change, verify that `/_serverFn/` returns JSON (not HTML) in dev mode.

## Related

- CONTEXT.md Pitfalls P001 (project-level reference)
- Git commit `924bfe1` (the fix)
