// The provider route lists against the provider itself.
//
// ./-$.test.ts proves the route refuses whatever is not allowed. This file
// proves the lists describe the real surface: it builds the configured
// Better Auth instance and enumerates every endpoint it would serve over HTTP.
// An endpoint on neither list fails the suite, so an upgrade or a new plugin
// cannot add a provider route that nobody decided on; an entry the provider no
// longer has fails it too, so a renamed route the product depends on is caught
// here and not by a user.

import { describe, expect, it } from 'vitest'
import {
  ALLOWED_PROVIDER_ROUTES,
  REFUSED_PROVIDER_ROUTES,
  classifyProviderRequest,
} from './-provider-routes'

const key = (route: Readonly<{ method: string; path: string }>): string =>
  `${route.method} ${route.path}`

type ProviderEndpoint = Readonly<{
  path?: string
  options?: Readonly<{ method?: string | ReadonlyArray<string> }>
}>

/**
 * Every (method, path) the configured provider has an HTTP route for. Its
 * router registers the `auth.api` entries that carry a path, once per method
 * (better-auth dist/api/index.mjs, better-call dist/router.mjs). The router
 * skips an entry marked server-only; this does not, so such an entry has to be
 * listed as refused before it could ever be served.
 */
async function exposedProviderRoutes(): Promise<ReadonlyArray<string>> {
  const { createAuth } = await import('#/shared/auth/auth')
  const api: Readonly<Record<string, ProviderEndpoint>> = createAuth().api
  return Object.values(api).flatMap((endpoint) => {
    if (!endpoint.path) return []
    const methods = endpoint.options?.method ?? []
    return (typeof methods === 'string' ? [methods] : methods).map((method) =>
      key({ method, path: endpoint.path ?? '' }),
    )
  })
}

describe('provider route lists', () => {
  it('classify every route the configured provider exposes, and nothing it does not', async () => {
    const exposed = await exposedProviderRoutes()
    const listed = [...ALLOWED_PROVIDER_ROUTES, ...REFUSED_PROVIDER_ROUTES].map(key)

    // `undecided` is a provider route nobody decided on: read its handler,
    // then allow it with a reason or refuse it on purpose
    // (./-provider-routes.ts). `stale` is an entry the provider no longer has.
    expect({
      undecided: exposed.filter((route) => !listed.includes(route)),
      stale: listed.filter((route) => !exposed.includes(route)),
    }).toEqual({ undecided: [], stale: [] })
  })

  it('never name a route twice', () => {
    const listed = [...ALLOWED_PROVIDER_ROUTES, ...REFUSED_PROVIDER_ROUTES].map(key)

    expect(listed.filter((route, index) => listed.indexOf(route) !== index)).toEqual([])
  })

  it('serve exactly the routes the product needs over HTTP', () => {
    // The whole allow list, written out: widening it is a reviewed decision,
    // so it has to change here as well as there.
    expect(ALLOWED_PROVIDER_ROUTES.map(key)).toEqual([
      'GET /get-session',
      'POST /sign-in/email',
      'POST /sign-out',
      'POST /request-password-reset',
      'GET /reset-password/:token',
      'POST /reset-password',
      'GET /verify-email',
    ])
  })

  // The routes that hand out invitation ids, or create or update an
  // Organization around the app, named so that allowing one of them fails a
  // case that says it must not be.
  it('never serve the organization routes that disclose or change more than the app does', () => {
    const decisions = (
      [
        ['GET', '/organization/list-invitations'],
        ['GET', '/organization/get-full-organization'],
        ['GET', '/organization/get-invitation'],
        ['GET', '/organization/list-members'],
        ['POST', '/organization/create'],
        ['POST', '/organization/update'],
      ] as const
    ).map(([method, path]) => classifyProviderRequest(method, `/api/auth${path}`))

    expect(decisions).toEqual([
      { allowed: false, route: '/organization/list-invitations' },
      { allowed: false, route: '/organization/get-full-organization' },
      { allowed: false, route: '/organization/get-invitation' },
      { allowed: false, route: '/organization/list-members' },
      { allowed: false, route: '/organization/create' },
      { allowed: false, route: '/organization/update' },
    ])
  })
})

describe('classifyProviderRequest', () => {
  it('allows a listed method and exact path under the provider base path', () => {
    expect(classifyProviderRequest('GET', '/api/auth/get-session')).toEqual({
      allowed: true,
      route: '/get-session',
    })
    expect(classifyProviderRequest('GET', '/api/auth/reset-password/abc123')).toEqual({
      allowed: true,
      route: '/reset-password/:token',
    })
  })

  it('refuses a known route under another method, naming the route', () => {
    expect(classifyProviderRequest('POST', '/api/auth/get-session')).toEqual({
      allowed: false,
      route: '/get-session',
    })
    expect(
      classifyProviderRequest('GET', '/api/auth/organization/list-invitations'),
    ).toEqual({ allowed: false, route: '/organization/list-invitations' })
    expect(classifyProviderRequest('GET', '/api/auth/callback/google')).toEqual({
      allowed: false,
      route: '/callback/:id',
    })
  })

  it('refuses a path outside the base path or one that names no provider route', () => {
    expect(classifyProviderRequest('GET', '/get-session')).toEqual({
      allowed: false,
      route: null,
    })
    expect(classifyProviderRequest('GET', '/api/authx/get-session')).toEqual({
      allowed: false,
      route: null,
    })
    expect(classifyProviderRequest('GET', '/api/auth')).toEqual({
      allowed: false,
      route: null,
    })
    expect(classifyProviderRequest('GET', '/api/auth/get-session/')).toEqual({
      allowed: false,
      route: null,
    })
  })
})
