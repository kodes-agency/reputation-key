// Platform operator console server functions (ADR 0063): who is acting.
//
// Shared by the console's read (platform-console.ts) and its changes
// (platform-console-changes.ts), which are separate modules so that the route's
// first-paint code holds only the read's stub (see platform-console-changes.ts).

import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { catchUntagged } from '#/shared/auth/server-errors'
import { isIdentityError } from '../domain/errors'
import type { PlatformOperatorActor } from '../application/dto/platform-console.dto'
import { throwIdentityError } from './organizations.errors.server'
import { requirePlatformOperator } from './platform-operator-access.server'
import { enforcePlatformConsoleRateLimit } from './platform-console-rate-limit.server'

function mapPlatformConsoleError(error: unknown): never {
  if (isIdentityError(error)) throwIdentityError(error)
  throw catchUntagged(error)
}

/** The signed-in operator; for a change, also fresh and within budget. */
async function resolveOperator(mutation: boolean): Promise<PlatformOperatorActor> {
  const headers = await headersFromContext()
  const { clock, logger, rateLimiter, identityRequestSecurity } = getContainer()
  const operator = await requirePlatformOperator(headers, {
    mutation,
    now: clock(),
    logger,
  })
  if (mutation) {
    await enforcePlatformConsoleRateLimit({
      rateLimiter,
      operatorUserId: operator.userId,
      keyHmacSecret: identityRequestSecurity.invitationRateLimitHmacSecret,
    })
  }
  return { userId: operator.userId, name: operator.name }
}

/** Resolve the operator, then run the console call; map every failure once. */
export async function asOperator<T>(
  mutation: boolean,
  run: (operator: PlatformOperatorActor) => Promise<T>,
): Promise<T> {
  try {
    return await run(await resolveOperator(mutation))
  } catch (error) {
    mapPlatformConsoleError(error)
  }
}
