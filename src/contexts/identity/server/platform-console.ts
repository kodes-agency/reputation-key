// Platform operator console server functions (ADR 0063).
//
// No tenant context: the operator holds no role in the Organizations the
// console lists. Every function re-checks the operator (a read accepts any
// session age; a change needs a sign-in within 30 minutes and draws on the
// operator's hourly budget) before it reaches the console capability.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { catchUntagged } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isIdentityError } from '../domain/errors'
import {
  inviteOrganizationAdminInputSchema,
  organizationInvitationInputSchema,
  provisionOrganizationInputSchema,
  type InviteOrganizationAdminInput,
  type InviteOrganizationAdminResult,
  type OrganizationInvitationInput,
  type PlatformOperatorActor,
  type PlatformOrganizationView,
  type ProvisionOrganizationInput,
  type ProvisionOrganizationResult,
  type ResendOrganizationAdminInvitationResult,
} from '../application/dto/platform-console.dto'
import { throwIdentityError } from './organizations.errors.server'
import { requirePlatformOperator } from './platform-operator-access.server'
import { enforcePlatformConsoleRateLimit } from './platform-console-rate-limit.server'

type Request<T> = Readonly<{ data: T }>

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
async function asOperator<T>(
  mutation: boolean,
  run: (operator: PlatformOperatorActor) => Promise<T>,
): Promise<T> {
  try {
    return await run(await resolveOperator(mutation))
  } catch (error) {
    mapPlatformConsoleError(error)
  }
}

/** The list names the invitees of ownerless Organizations: no cache keeps it. */
function keepListPrivate(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Vary', 'Cookie')
}

export const listPlatformOrganizationsHandler = createServerOnlyFn(
  (): Promise<ReadonlyArray<PlatformOrganizationView>> => {
    keepListPrivate()
    return asOperator(false, () => getContainer().identityPlatform.listOrganizations())
  },
)

export const provisionOrganizationHandler = createServerOnlyFn(
  ({ data }: Request<ProvisionOrganizationInput>): Promise<ProvisionOrganizationResult> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.provisionOrganization(data, operator),
    ),
)

export const inviteOrganizationAdminHandler = createServerOnlyFn(
  ({
    data,
  }: Request<InviteOrganizationAdminInput>): Promise<InviteOrganizationAdminResult> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.inviteAdmin(data, operator),
    ),
)

export const resendOrganizationAdminInvitationHandler = createServerOnlyFn(
  ({
    data,
  }: Request<OrganizationInvitationInput>): Promise<ResendOrganizationAdminInvitationResult> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.resendInvitation(data, operator),
    ),
)

export const cancelOrganizationAdminInvitationHandler = createServerOnlyFn(
  ({ data }: Request<OrganizationInvitationInput>): Promise<void> =>
    asOperator(true, (operator) =>
      getContainer().identityPlatform.cancelInvitation(data, operator),
    ),
)

export const listPlatformOrganizationsFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    listPlatformOrganizationsHandler,
    'GET',
    'identity.platform.listOrganizations',
  ),
)

export const provisionOrganizationFn = createServerFn({ method: 'POST' })
  .validator(provisionOrganizationInputSchema)
  .handler(
    tracedHandler(
      provisionOrganizationHandler,
      'POST',
      'identity.platform.provisionOrganization',
    ),
  )

export const inviteOrganizationAdminFn = createServerFn({ method: 'POST' })
  .validator(inviteOrganizationAdminInputSchema)
  .handler(
    tracedHandler(
      inviteOrganizationAdminHandler,
      'POST',
      'identity.platform.inviteAdmin',
    ),
  )

export const resendOrganizationAdminInvitationFn = createServerFn({ method: 'POST' })
  .validator(organizationInvitationInputSchema)
  .handler(
    tracedHandler(
      resendOrganizationAdminInvitationHandler,
      'POST',
      'identity.platform.resendInvitation',
    ),
  )

export const cancelOrganizationAdminInvitationFn = createServerFn({ method: 'POST' })
  .validator(organizationInvitationInputSchema)
  .handler(
    tracedHandler(
      cancelOrganizationAdminInvitationHandler,
      'POST',
      'identity.platform.cancelInvitation',
    ),
  )
