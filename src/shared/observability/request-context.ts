// Mark this module as server-only so TanStack Start's import protection
// mocks it in the client bundle (dev) instead of letting `node:async_hooks`
// execute in the browser and crash hydration. See TanStack Start docs:
// "Import Protection" — file markers.
import '@tanstack/react-start/server-only'

// Execution-scoped context via AsyncLocalStorage.
// Set once per request, operator command, or BullMQ job. Downstream code
// (logger, trace, durable-fact adapter) reads from ALS — no parameter threading.

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * Attributes enriched onto the current request span + every log line.
 * Set after tenant resolution via `enrichSpan()`. Because the immutable `Span`
 * (trace.ts) and pino child logger can't be mutated post-creation, these live
 * on the ALS store and are read dynamically — by the pino `mixin` (logger.ts)
 * on every log call, and by span-end logging (trace.ts).
 *
 * BQC-7.3 (observability schema): only content-free, low-cardinality attrs
 * live here — `role` (3 values), `useCase` (the route class) and `addressShape`
 * (2 values). Tenant identifiers (organizationId/userId) are NEVER span/log
 * attrs; the approved per-trace correlation is `requestId` (attached by
 * trace.ts, not the mixin).
 */
export interface SpanAttrs {
  role?: string
  useCase?: string
  /**
   * Which shape of Portal address a guest page read arrived by: the long
   * website address or a print code (ADR 0069). The shape only, never the address.
   */
  addressShape?: 'long' | 'short'
}

export interface RequestContext {
  readonly requestId: string
  /** ARC-01: direct cause for durable facts emitted in this execution. */
  readonly causationId?: string
  /** ARC-01: root command identifier propagated across its durable fact chain. */
  readonly commandId?: string
  /** Mutable span attributes — enriched after tenant resolution. */
  spanAttrs: SpanAttrs
  /** Per-request memo for resolveTenantContext (AC-03). Avoids re-work within one server fn. */
  resolvedTenantCtx?: import('#/shared/domain/auth-context').AuthContext
}

// The production build inlines this module into both the Nitro chunk and the
// SSR chunk. The pool, the database scope and the statement observer are
// process-wide, so the request they read must be too: with one storage per
// copy, a statement sent from a server function looked like it ran outside
// any request.
const STORAGE_KEY = Symbol.for('repkey.shared.observability.request-context')

function storage(): AsyncLocalStorage<RequestContext> {
  const global = globalThis as { [STORAGE_KEY]?: AsyncLocalStorage<RequestContext> }
  global[STORAGE_KEY] ??= new AsyncLocalStorage<RequestContext>()
  return global[STORAGE_KEY]
}

const asyncLocalStorage = storage()

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore()
}
/**
 * Enrich the current request's span attributes. Merges into the ALS store
 * so every subsequent log line and span-end carries them.
 *
 * Called from `resolveTenantContext` (role) and optionally from handler
 * bodies (useCase). No-op when called outside a request.
 */
export function enrichSpan(attrs: Partial<SpanAttrs>): void {
  const store = asyncLocalStorage.getStore()
  if (store) {
    Object.assign(store.spanAttrs, attrs)
  }
}

/** Read the current request's span attributes (for the pino mixin + span-end). */
export function getSpanAttrs(): SpanAttrs {
  return asyncLocalStorage.getStore()?.spanAttrs ?? {}
}

export function runWithContext<T>(
  requestId: string,
  fn: () => Promise<T>,
  identifiers: Readonly<{ causationId?: string; commandId?: string }> = {},
): Promise<T> {
  return asyncLocalStorage.run({ requestId, spanAttrs: {}, ...identifiers }, fn)
}

/**
 * Run a server route's handler as one request named by its route, so its log
 * lines and database statements carry that entry point. Server functions get
 * the same from `tracedHandler`.
 */
export function runServerRoute<T>(route: string, fn: () => Promise<T>): Promise<T> {
  return runWithContext(generateRequestId(), async () => {
    enrichSpan({ useCase: route })
    return fn()
  })
}

export function generateRequestId(): string {
  // 16 hex chars = 64 bits of entropy. Birthday collision risk drops to
  // ~1 in 10^9 at 1M requests/day. Full UUID (36 chars) is overkill for logs.
  return randomUUID().slice(0, 16)
}
