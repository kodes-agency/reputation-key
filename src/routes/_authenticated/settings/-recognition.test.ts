import { describe, expect, it } from 'vitest'
import { Route } from './recognition'

describe('Recognition beta route', () => {
  it('redirects stale deep links without loading the post-core model', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (typeof beforeLoad !== 'function') {
      throw new Error('Recognition route must define a beta fence')
    }

    let outcome: unknown
    try {
      beforeLoad({
        search: { propertyId: '10000000-0000-4000-8000-000000000001' },
      } as never)
    } catch (error) {
      outcome = error
    }

    expect(outcome).toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Recognition' },
      },
    })
    expect(Route.options.loader).toBeUndefined()
  })
})
