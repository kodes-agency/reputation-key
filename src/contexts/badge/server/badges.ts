// Badge context — server functions

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import {
  getStaffVisibleBadgesSchema,
  getVisibleTargetBadgesSchema,
  setOrganizationBadgeEnablementSchema,
} from '../application/dto/badge.dto'
import {
  propertyId,
  portalGroupId,
  portalId,
  badgeId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import { standardErrorStatus } from '#/shared/http/status'
import type { BadgeAwardWithTarget } from '../application/public-api'

export const badgeErrorStatus = standardErrorStatus

export const getStaffVisibleBadges = createServerFn({ method: 'GET' })
  .inputValidator(getStaffVisibleBadgesSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          await requireExecutionAllowed({ actor: ctx, action: 'badge.read' })
          return (await getContainer().badgePublicApi.getStaffVisibleBadges({
            organizationId: toOrgId(ctx.organizationId),
            userId: ctx.userId,
            propertyId: propertyId(data.propertyId),
            limit: data.limit,
          })) as BadgeAwardWithTarget[]
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'badge.getStaffVisibleBadges',
    ),
  )

export const getVisibleTargetBadges = createServerFn({ method: 'GET' })
  .inputValidator(getVisibleTargetBadgesSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          await requireExecutionAllowed({ actor: ctx, action: 'badge.read' })
          // Role-Filtered Badge Visibility (root CONTEXT.md):
          // AccountAdmin sees the whole org; PropertyManager must manage the
          // target property; Staff may only view an assigned portal or a group
          // that contains one of their assigned portals.
          if (ctx.role === 'Staff' || ctx.role === 'PropertyManager') {
            const visibility = await getContainer().badgePublicApi.resolveStaffVisibility(
              {
                organizationId: toOrgId(ctx.organizationId),
                userId: ctx.userId,
                propertyId: propertyId(data.propertyId),
              },
            )
            if (ctx.role === 'Staff') {
              const allowed =
                data.targetType === 'portal'
                  ? visibility.portalIds.some((id) => id === portalId(data.targetId))
                  : visibility.groupIds.some((id) => id === portalGroupId(data.targetId))
              if (!allowed) {
                throwContextError(
                  'AuthError',
                  { code: 'forbidden', message: 'Badge target not accessible' },
                  403,
                )
              }
            } else if (!visibility.hasPropertyAssignment) {
              throwContextError(
                'AuthError',
                { code: 'forbidden', message: 'Property not accessible' },
                403,
              )
            }
          }
          return (await getContainer().badgePublicApi.getVisibleTargetBadges({
            organizationId: toOrgId(ctx.organizationId),
            propertyId: propertyId(data.propertyId),
            targetType: data.targetType,
            targetId:
              data.targetType === 'portal'
                ? portalId(data.targetId)
                : portalGroupId(data.targetId),
          })) as BadgeAwardWithTarget[]
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'badge.getVisibleTargetBadges',
    ),
  )

export const setOrganizationBadgeEnablement = createServerFn({ method: 'POST' })
  .inputValidator(setOrganizationBadgeEnablementSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          await requireExecutionAllowed({ actor: ctx, action: 'badge.manage' })
          return await getContainer().badgePublicApi.setOrganizationBadgeEnablement(ctx, {
            organizationId: toOrgId(ctx.organizationId),
            badgeDefinitionId: badgeId(data.badgeDefinitionId),
            enabled: data.enabled,
          })
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'badge.setOrganizationBadgeEnablement',
    ),
  )

// ── getOrganizationBadgeDefinitions ───────────────────────────────

export const getOrganizationBadgeDefinitionsFn = createServerFn({
  method: 'GET',
}).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'badge.read' })
      const rows = await getContainer().badgePublicApi.getOrganizationBadgeDefinitions(
        toOrgId(ctx.organizationId),
      )
      return rows.map((row) => ({
        id: row.definition.id,
        key: row.definition.key,
        name: row.definition.name,
        description: row.definition.description,
        icon: row.definition.icon,
        targetScope: row.definition.targetScope,
        criteria: {
          type: row.definition.criteria.type,
          metricKey: row.definition.criteria.metricKey,
          operator: row.definition.criteria.operator,
          threshold: row.definition.criteria.threshold,
          aggregation: row.definition.criteria.aggregation,
          period: row.definition.criteria.period,
          streakDays: row.definition.criteria.streakDays,
          dailyThreshold: row.definition.criteria.dailyThreshold,
        },
        orgEnabled: row.orgEnabled,
      }))
    },
    'GET',
    'badge.getOrganizationBadgeDefinitions',
  ),
)
