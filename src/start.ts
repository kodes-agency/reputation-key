// Global TanStack Start configuration.
import { createMiddleware, createStart } from '@tanstack/react-start'
import { getSecurityHeaders } from '#/shared/security/security-headers'
// Policy administration is an operator-facing server surface rather than a
// route component. Import it here so its createServerFn handlers are present
// in the production server manifest.
import '#/contexts/identity/server/policy-admin'

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
  requestMiddleware: [cspNonceMiddleware],
}))
