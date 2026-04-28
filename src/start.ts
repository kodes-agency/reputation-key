// Global TanStack Start configuration
// Per Issue 4: sets up reusable auth middleware infrastructure.
// Server functions can opt into auth via .middleware([authMiddleware]).
import { createStart, createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getAuth } from '#/shared/auth/auth'

/**
 * Auth function middleware — resolves the session from request headers.
 * Server functions opt in by adding .middleware([authMiddleware]) to their chain.
 * Context will contain { session } for downstream handlers.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest()
    const auth = getAuth()
    const session = await auth.api.getSession({ headers: request.headers })
    return next({ context: { session } })
  },
)

export const startInstance = createStart(() => ({}))
