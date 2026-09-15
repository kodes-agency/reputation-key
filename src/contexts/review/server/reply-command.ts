// Review context — the guard every reply command server function runs.
//
// Only ever called from inside a server function handler. TanStack Start
// replaces those handlers with RPC stubs in the client build and drops the
// imports they alone used, so this module and the composition root behind it
// never reach the browser. Importing it anywhere a client module evaluates
// would pull server-only code past import protection.

import { getContainer, type Container } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { AuthContext } from '#/shared/domain/auth-context'
import { isReviewError } from '../domain/errors'
import { reviewErrorStatus } from './reply-read'

type ReplyCommands = Container['reviewPublicApi']['reply']

/**
 * Runs one reply command for the signed-in manager: the session's tenant,
 * `reply.manage` before the Review API is touched, then the command. A
 * ReviewError reaches the client with its HTTP status and its sentence;
 * anything untagged is masked as a 500. Only the command differs between the
 * server functions that use it.
 */
export async function runReplyCommand<T>(
  command: (reply: ReplyCommands, ctx: AuthContext) => Promise<T>,
): Promise<T> {
  const headers = await headersFromContext()
  const ctx = await resolveTenantContext(headers)
  await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
  const { reviewPublicApi } = getContainer()
  try {
    return await command(reviewPublicApi.reply, ctx)
  } catch (e) {
    if (isReviewError(e)) throwContextError('ReviewError', e, reviewErrorStatus(e.code))
    throw catchUntagged(e)
  }
}
