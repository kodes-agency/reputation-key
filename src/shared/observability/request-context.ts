// Mark this module as server-only so TanStack Start's import protection
// mocks it in the client bundle (dev) instead of letting `node:async_hooks`
// execute in the browser and crash hydration. See TanStack Start docs:
// "Import Protection" — file markers.
import '@tanstack/react-start/server-only'

// Request-scoped context via AsyncLocalStorage.
// Set once per request at the server function or route loader boundary.
// Downstream code (logger, trace) reads from ALS — no parameter threading.

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/**
 * Attributes enriched onto the current request span + every log line.
 * Set after tenant resolution via `enrichSpan()`. Because the immutable `Span`
 * (trace.ts) and pino child logger can't be mutated post-creation, these live
 * on the ALS store and are read dynamically — by the pino `mixin` (logger.ts)
 * on every log call, and by span-end logging (trace.ts).
 */
export interface SpanAttrs {
  organizationId?: string
  userId?: string
  role?: string
  useCase?: string
  resource?: string
}

export interface RequestContext {
  readonly requestId: string
  /** Mutable span attributes — enriched after tenant resolution. */
  spanAttrs: SpanAttrs
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore()
}
/**
 * Enrich the current request's span attributes. Merges into the ALS store
 * so every subsequent log line and span-end carries them.
 *
 * Called from `resolveTenantContext` (identity attrs) and optionally from
 * handler bodies (useCase/resource). No-op when called outside a request.
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

export function runWithContext<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return asyncLocalStorage.run({ requestId, spanAttrs: {} }, fn)
}

export function generateRequestId(): string {
  // 16 hex chars = 64 bits of entropy. Birthday collision risk drops to
  // ~1 in 10^9 at 1M requests/day. Full UUID (36 chars) is overkill for logs.
  return randomUUID().slice(0, 16)
}
