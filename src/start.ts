// Global TanStack Start configuration.
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'
import { getSecurityHeaders } from '#/shared/security/security-headers'
// Policy administration is an operator-facing server surface rather than a
// route component. Import it here so its createServerFn handlers are present
// in the production server manifest.
import '#/contexts/identity/server/policy-admin'
// ARC-03-T8 note: the web process's policy installation is NOT wired here.
// The TanStack Start plugin adds this file as an import-protection graph entry
// for the CLIENT environment too, and '**/composition.ts' is on the client
// deny list — importing the composition root here would fail the build. The
// web installation point is src/composition.ts's single
// registerProcessPolicyColdBoot call, which is the only server-side module
// loaded in both the vite dev SSR runtime and the production server before the
// first gated request (Nitro plugins do not execute under vite dev).

// TanStack Start disables its default server-function CSRF middleware as soon
// as an application supplies a custom start instance. Restore the framework's
// documented policy explicitly: only server-function RPC requests are in
// scope, and they must carry same-origin Fetch Metadata or exact-origin
// Origin/Referer evidence. `same-site` is intentionally insufficient because
// a sibling subdomain may be independently controlled.
const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === 'serverFn',
  secFetchSite: 'same-origin',
  allowRequestsWithoutOriginCheck: false,
})

const cspNonceMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ handlerType, next }) => {
    const cspNonce = crypto.randomUUID().replaceAll('-', '')
    const result = await next({ context: { cspNonce } })

    // Router responses render framework and application inline scripts. Their
    // nonce must be carried by the matching CSP; API/server-function responses
    // retain the static default from the Nitro response plugin.
    if (handlerType === 'router') {
      result.response.headers.set(
        'Content-Security-Policy',
        getSecurityHeaders({ cspNonce })['Content-Security-Policy'],
      )
    }

    return result
  },
)

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, cspNonceMiddleware],
}))
