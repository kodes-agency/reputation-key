import type { StaffPublicApi } from '#/contexts/identity/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { ResponseTargetStore } from './store.port.server'
import type { ResponseTargetPolicyStore } from './policy.store.port.server'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import {
  assertInboxSourcePropertyAccessible,
  canReadInboxSource,
  resolveInboxSourceScopes,
} from '../inbox/inbox-access.server'
import { inboxError } from '../domain/inbox-errors'

type SharedDeps = Readonly<{
  targetStore: ResponseTargetStore
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export type GetPrivateFeedbackTargetAnalytics = ReturnType<
  typeof getPrivateFeedbackTargetAnalytics
>
export type GetPrivateFeedbackTargetAnalyticsDeps = SharedDeps
export type GetPrivateFeedbackTargetAnalyticsInput = Readonly<{
  propertyId?: PropertyId
}>

export const getPrivateFeedbackTargetAnalytics = (
  deps: GetPrivateFeedbackTargetAnalyticsDeps,
) => {
  return async (input: GetPrivateFeedbackTargetAnalyticsInput, ctx: AuthContext) => {
    if (!canReadInboxSource(ctx, 'feedback')) {
      throw inboxError('forbidden', 'No permission to read private-feedback targets')
    }
    if (input.propertyId) {
      await assertInboxSourcePropertyAccessible(
        deps.staffPublicApi,
        ctx,
        'read',
        'feedback',
        input.propertyId,
      )
    }
    const scopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    const feedbackScope = scopes.find((scope) => scope.sourceType === 'feedback')
    const propertyIds = input.propertyId
      ? [input.propertyId]
      : feedbackScope?.propertyIds === undefined
        ? feedbackScope
          ? null
          : []
        : feedbackScope.propertyIds

    return deps.targetStore.getPrivateFeedbackAnalytics({
      organizationId: ctx.organizationId,
      propertyIds,
      now: deps.clock(),
    })
  }
}

export type GetGoogleReviewTargetAnalytics = ReturnType<
  typeof getGoogleReviewTargetAnalytics
>
export type GetGoogleReviewTargetAnalyticsDeps = SharedDeps
export type GetGoogleReviewTargetAnalyticsInput = Readonly<{
  propertyId?: PropertyId
}>

export const getGoogleReviewTargetAnalytics = (
  deps: GetGoogleReviewTargetAnalyticsDeps,
) => {
  return async (input: GetGoogleReviewTargetAnalyticsInput, ctx: AuthContext) => {
    if (!canReadInboxSource(ctx, 'review')) {
      throw inboxError('forbidden', 'No permission to read Google review targets')
    }
    if (input.propertyId) {
      await assertInboxSourcePropertyAccessible(
        deps.staffPublicApi,
        ctx,
        'read',
        'review',
        input.propertyId,
      )
    }
    const scopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    const reviewScope = scopes.find((scope) => scope.sourceType === 'review')
    const propertyIds = input.propertyId
      ? [input.propertyId]
      : reviewScope?.propertyIds === undefined
        ? reviewScope
          ? null
          : []
        : reviewScope.propertyIds

    return deps.targetStore.getGoogleReviewAnalytics({
      organizationId: ctx.organizationId,
      propertyIds,
      now: deps.clock(),
    })
  }
}

export type GetResponseTargetPolicySettings = ReturnType<
  typeof getResponseTargetPolicySettings
>
export type GetResponseTargetPolicySettingsDeps = Readonly<{
  policyStore: ResponseTargetPolicyStore
}>
export type GetResponseTargetPolicySettingsInput = Readonly<{
  propertyId?: PropertyId
}>

export const getResponseTargetPolicySettings = (
  deps: GetResponseTargetPolicySettingsDeps,
) => {
  return async (input: GetResponseTargetPolicySettingsInput, ctx: AuthContext) => {
    if (
      !canForContext(ctx, 'organization.update') ||
      scopeForPermission(ctx, 'organization.update') !== 'organization'
    ) {
      throw inboxError(
        'forbidden',
        'Organization administrator permission is required for Response Targets',
      )
    }
    return deps.policyStore.getPolicySettings(ctx.organizationId, input.propertyId)
  }
}
