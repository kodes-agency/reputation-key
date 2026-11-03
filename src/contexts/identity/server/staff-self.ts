import { rethrowStaffAccount } from './staff-account-errors'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError } from '#/shared/auth/server-errors'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import type { AuthContext } from '#/shared/domain/auth-context'
import { STAFF_NOTICE_VERSION } from '../domain/staff-account'
import { requireOwnParticipation, resolveStaffSelfContext } from './staff-self-context'

const NO_LOOK = {
  displayName: '',
  wordmark: null,
  logo: null,
  hero: null,
  accentColour: '',
  fieldColour: '',
}

/** The look only dresses the home, so failing to read it must not take the home away. */
async function ownLookOrNone(
  row: Readonly<{ portalId: string; propertyActive: boolean }>,
  ctx: AuthContext,
) {
  try {
    return await getContainer().portalPublicApi.management.getOwnPersonalLook(
      { portalId: row.portalId, paused: !row.propertyActive },
      ctx,
    )
  } catch (error) {
    // `forbidden` is a Portal not yet this person's, mid-setup. Anything else is a fault.
    if ((error as { code?: unknown } | null)?.code !== 'forbidden')
      captureObservabilityException(error, { source: 'nitro' })
    return NO_LOOK
  }
}

export const getMyStaffHomeHandler = createServerOnlyFn(async () => {
  setResponseHeader('Cache-Control', 'private, no-store')
  const { ctx, person } = await resolveStaffSelfContext(await headersFromContext())
  await requireExecutionAllowed({
    actor: ctx,
    action: 'staff.self',
    capability: 'staff.accounts',
  })
  return {
    participations: await Promise.all(
      person.participations.map(async (row) => {
        const look = await ownLookOrNone(row, ctx)
        return {
          participationId: row.participationId,
          look,
          propertyName: look.displayName || row.propertyName,
          portalState: row.portalState,
          noticeAcknowledged: person.noticeVersion === STAFF_NOTICE_VERSION,
          colleagueListEnabled: row.colleagueListEnabled,
        }
      }),
    ),
  }
})

export const getMyStaffHome = createServerFn({ method: 'GET' }).handler(
  tracedHandler(getMyStaffHomeHandler, 'GET', 'identity.getMyStaffHome'),
)

export const getMyCodeHandler = createServerOnlyFn(
  async ({ data }: { data: { participationId: string } }) => {
    setResponseHeader('Cache-Control', 'private, no-store')
    const { ctx, person } = await resolveStaffSelfContext(await headersFromContext())
    const own = requireOwnParticipation(person, data.participationId)
    await requireExecutionAllowed({
      actor: ctx,
      action: 'staff.self',
      capability: 'staff.accounts',
      propertyId: own.propertyId,
    })
    if (!own.propertyActive || own.portalState === 'paused')
      return { state: 'paused' as const }
    const container = getContainer()
    const budget = await container.rateLimiter.check(
      `staff:own-code:${ctx.organizationId}:${ctx.userId}`,
      { maxRequests: 120, windowSeconds: 3600 },
    )
    if (!budget.allowed)
      throwContextError(
        'StaffAccountError',
        {
          code: 'rate_limited',
          message: 'Please wait before opening your code again',
        },
        429,
      )
    try {
      const code = await container.portalPublicApi.management.getOwnPersonalCode(
        { portalId: own.portalId },
        ctx,
      )
      return code.state === 'paused'
        ? { state: 'paused' as const }
        : {
            state: 'live' as const,
            qr: code.qr,
            wordingKey: code.wordingKey,
            headline: code.headline,
            subline: code.subline,
            cue: code.cue,
          }
    } catch (error) {
      rethrowStaffAccount(error)
    }
  },
)

export const getMyCode = createServerFn({ method: 'POST' })
  .validator(z.object({ participationId: z.uuid() }).strict())
  .handler(tracedHandler(getMyCodeHandler, 'POST', 'identity.getMyCode'))

export const acknowledgeStaffNoticeHandler = createServerOnlyFn(
  async ({ data }: { data: { version: string } }) => {
    const { ctx } = await resolveStaffSelfContext(await headersFromContext())
    await requireExecutionAllowed({
      actor: ctx,
      action: 'staff.self',
      capability: 'staff.accounts',
    })
    if (data.version !== STAFF_NOTICE_VERSION)
      throwContextError(
        'StaffAccountError',
        {
          code: 'notice_version_changed',
          message: 'Read the current staff notice before continuing',
        },
        409,
      )
    await getContainer().identityPublicApi.staffSelf.acknowledge(
      ctx.organizationId,
      ctx.userId,
      data.version,
    )
    return { acknowledged: true as const }
  },
)

export const acknowledgeStaffNotice = createServerFn({ method: 'POST' })
  .validator(z.object({ version: z.string().max(64) }).strict())
  .handler(
    tracedHandler(
      acknowledgeStaffNoticeHandler,
      'POST',
      'identity.acknowledgeStaffNotice',
    ),
  )
