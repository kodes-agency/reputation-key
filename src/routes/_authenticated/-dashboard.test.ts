import { describe, expect, it } from 'vitest'
import { Route } from './dashboard'

/**
 * The fleet page is gone (docs/plan/dashboard-redesign.md row 3). What was
 * tested here — the 0 / 1 / 2+ property branch, the single-property redirect,
 * and priming fleet data only for multi-property organizations — went with it:
 * `/properties` renders every one of those cases as one list, and its own
 * figures are failure-isolated `useQuery` enrichments rather than loader work
 * with a branch to get wrong.
 *
 * What is still worth pinning is that the path a manager has bookmarked, and
 * that every capability denial used to fall back to, still lands somewhere.
 */
describe('Dashboard path', () => {
  it('redirects to the properties list', async () => {
    const beforeLoad = Route.options.beforeLoad
    if (!beforeLoad) throw new Error('The dashboard route must define beforeLoad')

    await expect(
      Promise.resolve().then(() => beforeLoad({} as never)),
    ).rejects.toMatchObject({
      options: { to: '/properties', replace: true },
    })
  })

  it('carries no loader, no search, and no capability gate of its own', () => {
    // A redirect that gated on `dashboard.fleet_read` would bounce a manager to
    // /unavailable on their way to a list they are allowed to read; the
    // destination applies its own gate.
    expect(Route.options.loader).toBeUndefined()
    expect(Route.options.validateSearch).toBeUndefined()
  })
})
