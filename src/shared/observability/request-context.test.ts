import { describe, expect, it, vi } from 'vitest'

// The production build inlines request-context twice (the Nitro chunk and the
// SSR chunk). A fresh module registry stands in for the second copy.
async function freshCopy() {
  vi.resetModules()
  return import('./request-context')
}

describe('request context across bundle copies', () => {
  it('a request entered through one copy is the request every copy reads', async () => {
    const serverFunctions = await freshCopy()
    const pool = await freshCopy()

    const seen = await serverFunctions.runWithContext('request-1', async () => {
      serverFunctions.enrichSpan({ useCase: 'listReviews' })
      return {
        requestId: pool.getRequestContext()?.requestId,
        useCase: pool.getSpanAttrs().useCase,
      }
    })

    expect(seen).toEqual({ requestId: 'request-1', useCase: 'listReviews' })
  })

  it('names a server route as the entry point of its request', async () => {
    const context = await freshCopy()

    const useCase = await context.runServerRoute(
      '/api/webhooks/resend/events',
      async () => context.getSpanAttrs().useCase,
    )

    expect(useCase).toBe('/api/webhooks/resend/events')
    expect(context.getRequestContext()).toBeUndefined()
  })
})
