// Request-scoped context via AsyncLocalStorage.
// Set once per request at the server function or route loader boundary.
// Downstream code (logger, trace) reads from ALS — no parameter threading.

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export interface RequestContext {
  readonly requestId: string
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore()
}

export function runWithContext<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return asyncLocalStorage.run({ requestId }, fn)
}

export function generateRequestId(): string {
  // 16 hex chars = 64 bits of entropy. Birthday collision risk drops to
  // ~1 in 10^9 at 1M requests/day. Full UUID (36 chars) is overkill for logs.
  return randomUUID().slice(0, 16)
}
