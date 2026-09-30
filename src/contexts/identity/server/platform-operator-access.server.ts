// Identity context — who may use the platform operator console (ADR 0063).
//
// An operator is a signed-in user whose ACCOUNT is registered in
// OPS_OPERATOR_IDENTITIES on the web service, as `user:<user id>`. The check
// is the ExecutionPolicy operator branch (`system:ops`) the ops CLI already
// uses, so an absent or empty list means no one.
//
// The principal is the user id, never the email. An AccountAdmin can invite
// any address that has no account yet and register it through that
// invitation, which verifies the address (ADR 0062); a listed email would
// belong to whoever invites it first. A user id exists only once its account
// does, and the owner copies their own into the list. Email entries still
// name operators for the ops CLI; on web they never match.
//
// A console change also needs a recent sign-in. There is no MFA in the beta;
// the 30-minute rule is its only step-up, and reads are exempt so the list
// stays visible while the operator is asked to sign in again.

import { getSessionFromHeaders } from '#/shared/auth/middleware'
import { throwAuthError } from '#/shared/auth/auth-errors'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { throwContextError } from '#/shared/auth/server-errors'
import { userId as toUserId, type UserId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'

/** A console change needs a session signed in at most this long ago. */
export const OPERATOR_MUTATION_SESSION_MAX_AGE_MS = 30 * 60 * 1000

/** The ExecutionPolicy action every operator decision evaluates. */
const OPERATOR_ACTION = 'system:ops'

export type PlatformOperator = Readonly<{
  userId: UserId
  name: string
}>

export type PlatformOperatorCheck = Readonly<{
  mutation: boolean
  now: Date
  /** Receives one content-free warn line per refusal. */
  logger: Pick<LoggerPort, 'warn'>
  correlationId?: string
}>

/** The allowlist entry that names a user's account: `user:<user id>`. */
export function operatorPrincipalId(user: Readonly<{ id: string }>): string {
  return `user:${user.id}`
}

function refuseOperator(logger: Pick<LoggerPort, 'warn'>, reason: string): never {
  // Content-free (observability schema): the request's trace correlates it.
  logger.warn(
    { event: 'platform.operator_denied', reason },
    'Platform console refused a user who is not a registered operator',
  )
  throwContextError(
    'AuthError',
    { code: reason, message: 'This page is for platform operators.' },
    403,
  )
}

/**
 * Resolve the signed-in platform operator or refuse: 401 without a session,
 * 403 with the policy reason for anyone else, 403 `operator_reauth_required`
 * for a change on a session older than 30 minutes.
 */
export async function requirePlatformOperator(
  headers: Headers,
  options: PlatformOperatorCheck,
): Promise<PlatformOperator> {
  const signedIn = await getSessionFromHeaders(headers)
  if (!signedIn) {
    throwAuthError('unauthorized', 'Valid session required')
  }
  const { session, user } = signedIn

  const decision = await getExecutionPolicy().decide({
    principal: { kind: 'operator', id: operatorPrincipalId(user) },
    action: OPERATOR_ACTION,
    executionKind: 'operator',
    now: options.now,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  })
  if (!decision.allowed) refuseOperator(options.logger, decision.reason)

  const sessionAgeMs = options.now.getTime() - new Date(session.createdAt).getTime()
  if (options.mutation && sessionAgeMs > OPERATOR_MUTATION_SESSION_MAX_AGE_MS) {
    throwContextError(
      'AuthError',
      {
        code: 'operator_reauth_required',
        message: 'Sign in again to change Organizations from the operator console.',
      },
      403,
    )
  }
  return { userId: toUserId(user.id), name: user.name }
}
