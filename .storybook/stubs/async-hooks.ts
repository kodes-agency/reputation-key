// Browser polyfill for node:async_hooks.
// better-auth (used app-wide) creates an AsyncLocalStorage for request-scoped
// context; when bundled into Storybook's browser preview, Vite externalizes the
// Node builtin and `new AsyncLocalStorage()` throws. This stub provides a
// minimal implementation so the preview renders. Store is NOT propagated across
// real async boundaries (sufficient for rendering; stories don't need request
// isolation).

export class AsyncLocalStorage<T> {
  #store: T | undefined
  run<R>(store: T, callback: () => R): R {
    const prev = this.#store
    this.#store = store
    try {
      return callback()
    } finally {
      this.#store = prev
    }
  }
  getStore(): T | undefined {
    return this.#store
  }
  enterWith(store: T): void {
    this.#store = store
  }
  disable(): void {
    this.#store = undefined
  }
}

export class AsyncResource {
  bind<T>(fn: T): T {
    return fn
  }
  run<R>(callback: () => R): R {
    return callback()
  }
}

export const createHook = () => ({ enable() {}, disable() {} })
export const executionAsyncId = () => 0
export const executionAsyncResource = () => ({})
