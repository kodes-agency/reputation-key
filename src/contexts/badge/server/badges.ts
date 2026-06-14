// Badge context — server functions

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { can } from '#/shared/domain/permissions'
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
          if (!can(ctx.role, 'badge.read')) {
            throwContextError(
              'AuthError',
              { code: 'forbidden', message: 'No badge read permission' },
              403,
            )
          }
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
          if (!can(ctx.role, 'badge.read')) {
            throwContextError(
              'AuthError',
              { code: 'forbidden', message: 'No badge read permission' },
              403,
            )
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
          if (!can(ctx.role, 'badge.manage')) {
            throwContextError(
              'AuthError',
              { code: 'forbidden', message: 'No badge manage permission' },
              403,
            )
          }
          return await getContainer().badgePublicApi.setOrganizationBadgeEnablement(
            toOrgId(ctx.organizationId),
            badgeId(data.badgeDefinitionId),
            data.enabled,
          )
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'badge.setOrganizationBadgeEnablement',
    ),
  )
