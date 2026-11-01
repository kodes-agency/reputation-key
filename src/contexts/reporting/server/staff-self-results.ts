import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { requireOwnParticipation, resolveStaffSelfContext } from './staff-self-context'

const periodInput = z
  .object({ participationId: z.uuid(), period: z.enum(['today', 'week', 'month']) })
  .strict()

export const getMyResultsHandler = async ({
  data,
}: {
  data: { participationId: string; period: 'today' | 'week' | 'month' }
}) => {
  const { ctx, person } = await resolveStaffSelfContext(await headersFromContext())
  const own = requireOwnParticipation(person, data.participationId)
  await requireExecutionAllowed({
    actor: ctx,
    action: 'staff.self',
    capability: 'staff.accounts',
    propertyId: own.propertyId,
  })
  const result = await getContainer().dashboardPublicApi.staffSelf.results(
    { ...own, organizationId: ctx.organizationId },
    data.period,
  )
  return {
    scans: result.scans,
    ...(data.period === 'today'
      ? {}
      : {
          ratingCount: result.ratingCount,
          ...(result.averageRating === undefined
            ? {}
            : { averageRating: result.averageRating }),
          ratingsCutoff: result.ratingsCutoff,
        }),
  }
}

export const getMyResults = createServerFn({ method: 'GET' })
  .validator(periodInput)
  .handler(tracedHandler(getMyResultsHandler, 'GET', 'reporting.getMyResults'))

export const getMyGoalsHandler = async ({
  data,
}: {
  data: { participationId: string }
}) => {
  const { ctx, person } = await resolveStaffSelfContext(await headersFromContext())
  const own = requireOwnParticipation(person, data.participationId)
  await requireExecutionAllowed({
    actor: ctx,
    action: 'staff.self',
    capability: 'staff.accounts',
    propertyId: own.propertyId,
  })
  if (!getContainer().dashboardPublicApi.staffSelf.targetsEnabled) return { goals: [] }
  const goals = await getContainer().dashboardPublicApi.staffSelf.goals({
    ...own,
    organizationId: ctx.organizationId,
  })
  return {
    goals: goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      target: goal.target,
      scans: goal.scans,
    })),
  }
}

export const getMyGoals = createServerFn({ method: 'GET' })
  .validator(z.object({ participationId: z.uuid() }).strict())
  .handler(tracedHandler(getMyGoalsHandler, 'GET', 'reporting.getMyGoals'))

export const getMyColleaguesHandler = async ({
  data,
}: {
  data: { participationId: string; period: 'today' | 'week' | 'month' }
}) => {
  const { ctx, person } = await resolveStaffSelfContext(await headersFromContext())
  const own = requireOwnParticipation(person, data.participationId)
  await requireExecutionAllowed({
    actor: ctx,
    action: 'staff.self',
    capability: 'staff.accounts',
    propertyId: own.propertyId,
  })
  if (!own.colleagueListEnabled)
    throwContextError(
      'StaffAccountError',
      {
        code: 'colleague_list_disabled',
        message: 'The colleague list is not enabled at this Property',
      },
      403,
    )
  const container = getContainer()
  const roster = await container.identityPublicApi.staffSelf.colleagues(
    ctx.organizationId,
    own.propertyId,
  )
  const counts = await container.dashboardPublicApi.staffSelf.scans(
    { ...own, organizationId: ctx.organizationId },
    roster.map((row) => row.portalId),
    data.period,
  )
  return {
    colleagues: roster.map((row) => ({
      displayName: row.displayName,
      scans: counts.get(row.portalId) ?? 0,
      isYou: row.participantId === person.participantId,
    })),
  }
}

export const getMyColleagues = createServerFn({ method: 'GET' })
  .validator(periodInput)
  .handler(tracedHandler(getMyColleaguesHandler, 'GET', 'reporting.getMyColleagues'))
