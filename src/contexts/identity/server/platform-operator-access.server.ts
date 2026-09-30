// Identity context — who may use the platform operator console (ADR 0063).
//
// An operator is a signed-in user whose VERIFIED email, trimmed and
// lowercased, is registered in OPS_OPERATOR_IDENTITIES on the web service. The
// check is the ExecutionPolicy operator branch (`system:ops`) the ops CLI
// already uses, so an absent or empty list means no one. The list itself is
// not case-folded: its entries must be written in lowercase.
//
// A console change also needs a recent sign-in. There is no MFA in the beta;
// the 30-minute rule is its only step-up, and reads are exempt so the list
// stays visible while the operator is asked to sign in again.

import { getSessionFromHeaders } from '#/shared/auth/middleware'
import { throwAuthError } from '#/shared/auth/auth-errors'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { throwContextError } from '#/shared/auth/server-errors'
import { userId as toUserId, type UserId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'

/** A console change needs a session signed in at most this long ago. */
export const OPERATOR_MUTATION_SESSION_MAX_AGE_MS = 30 * 60 * 1000

/** The ExecutionPolicy action every operator decision evaluates. */
const OPERATOR_ACTION = 'system:ops'

export type PlatformOperator = Readonly<{
  userId: UserId
  /** The registered principal: the verified email, lowercased. */
  email: string
  name: string
}>

export type PlatformOperatorCheck = Readonly<{
  mutation: boolean
  now: Date
  correlationId?: string
}>

/** The operator principal a user can present: a verified email, or nothing. */
export function operatorPrincipalId(
  user: Readonly<{ email: string; emailVerified: boolean }>,
): string | null {
  return user.emailVerified ? user.email.trim().toLowerCase() : null
}

function refuseOperator(userId: string, reason: string): never {
  getLogger().warn(
    { event: 'platform.operator_denied', userId, reason },
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
  const principal = operatorPrincipalId(user)
  if (principal === null) refuseOperator(user.id, 'operator_not_registered')

  const decision = await getExecutionPolicy().decide({
    principal: { kind: 'operator', id: principal },
    action: OPERATOR_ACTION,
    executionKind: 'operator',
    now: options.now,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  })
  if (!decision.allowed) refuseOperator(user.id, decision.reason)

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
  return { userId: toUserId(user.id), email: principal, name: user.name }
}
