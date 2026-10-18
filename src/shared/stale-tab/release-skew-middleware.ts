// The two halves of the release check that rides on every server-function call
// (see release-skew.ts for what it decides and why).
//
// The CLIENT half states which release the tab's code came from and tells the
// tab when the server says it is stale. The SERVER half runs first of everything
// a function has: ahead of its validator, its handler and the other middleware,
// so a refused read never starts any work.
//
// Registered once, globally, in src/start.ts. The client half depends on the
// server half, which is how Start gives the browser the server's `sendContext`.

import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getReleaseSha } from '#/shared/config/env'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'
import { RELEASE_HEADER, answerSkew, isStaleClientError } from './release-skew'
import { staleClientRefusal } from './stale-client-refusal'
import { staleTab, type StaleTab } from './stale-tab'

/** The server's own release, or undefined if it cannot be read: the check then lets calls through. */
function readServerRelease(): string | undefined {
  try {
    return getReleaseSha(requestRuntimeConfig().env)
  } catch {
    return undefined
  }
}

export const releaseSkewServerMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next, method }) => {
    const answer = answerSkew({
      tabRelease: getRequest().headers.get(RELEASE_HEADER),
      serverRelease: readServerRelease(),
      method,
    })
    if (answer === 'refuse') throw staleClientRefusal()
    return next(answer === 'flag' ? { sendContext: { releaseSkew: true } } : {})
  },
)

type Settled = Readonly<{ context?: unknown }>

function isFlagged(result: Settled): boolean {
  const context = result.context as { releaseSkew?: unknown } | undefined
  return context?.releaseSkew === true
}

/**
 * One call as the tab makes it. A tab that does not know its release changes
 * nothing about the call. A mutation counts as in flight until it settles, so no
 * reload can cut it off.
 */
export async function sendWithRelease<R extends Settled>(
  tab: StaleTab,
  method: string,
  next: (options?: { headers: Record<string, string> }) => Promise<R>,
): Promise<R> {
  const release = tab.release()
  if (!release) return next()
  const call = next({ headers: { [RELEASE_HEADER]: release } })
  try {
    const result = await (method === 'POST' ? tab.trackMutation(call) : call)
    if (isFlagged(result)) tab.markStale()
    return result
  } catch (error) {
    if (isStaleClientError(error)) tab.markStale()
    throw error
  }
}

export const releaseSkewClientMiddleware = createMiddleware({ type: 'function' })
  .middleware([releaseSkewServerMiddleware])
  .client(async ({ next, method }) => sendWithRelease(staleTab, method, next))
