import { describe, expect, it } from 'vitest'
import { Route } from './leaderboard'

describe('Achievement Board beta route', () => {
  it('redirects stale leaderboard links without loading the post-core model', () => {
    const beforeLoad = Route.options.beforeLoad
    if (typeof beforeLoad !== 'function') {
      throw new Error('Leaderboard route must define a beta fence')
    }

    let outcome: unknown
    try {
      beforeLoad({
        search: {
          propertyId: '10000000-0000-4000-8000-000000000001',
          portalGroupId: '20000000-0000-4000-8000-000000000002',
        },
      } as never)
    } catch (error) {
      outcome = error
    }

    expect(outcome).toMatchObject({
      options: {
        to: '/unavailable',
        search: { feature: 'Achievement Board' },
      },
    })
    expect(Route.options.loader).toBeUndefined()
  })
})
