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

type TargetAnalyticsInput = Readonly<{ propertyId?: PropertyId }>

const readTargetAnalytics =
  <Result>(
    deps: SharedDeps,
    sourceType: 'feedback' | 'review',
    refusal: string,
    read: (
      query: Readonly<{
        organizationId: AuthContext['organizationId']
        propertyIds: ReadonlyArray<PropertyId> | null
        now: Date
      }>,
    ) => Promise<Result>,
  ) =>
  async (input: TargetAnalyticsInput, ctx: AuthContext): Promise<Result> => {
    if (!canReadInboxSource(ctx, sourceType)) {
      throw inboxError('forbidden', refusal)
    }
    if (input.propertyId) {
      await assertInboxSourcePropertyAccessible(
        deps.staffPublicApi,
        ctx,
        'read',
        sourceType,
        input.propertyId,
      )
    }
    const scopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    const sourceScope = scopes.find((scope) => scope.sourceType === sourceType)
    const propertyIds = input.propertyId
      ? [input.propertyId]
      : sourceScope?.propertyIds === undefined
        ? sourceScope
          ? null
          : []
        : sourceScope.propertyIds

    return read({
      organizationId: ctx.organizationId,
      propertyIds,
      now: deps.clock(),
    })
  }

export type GetPrivateFeedbackTargetAnalytics = ReturnType<
  typeof getPrivateFeedbackTargetAnalytics
>
export type GetPrivateFeedbackTargetAnalyticsDeps = SharedDeps
export type GetPrivateFeedbackTargetAnalyticsInput = TargetAnalyticsInput

export const getPrivateFeedbackTargetAnalytics = (
  deps: GetPrivateFeedbackTargetAnalyticsDeps,
) =>
  readTargetAnalytics(
    deps,
    'feedback',
    'No permission to read private-feedback targets',
    (query) => deps.targetStore.getPrivateFeedbackAnalytics(query),
  )

export type GetGoogleReviewTargetAnalytics = ReturnType<
  typeof getGoogleReviewTargetAnalytics
>
export type GetGoogleReviewTargetAnalyticsDeps = SharedDeps
export type GetGoogleReviewTargetAnalyticsInput = TargetAnalyticsInput

export const getGoogleReviewTargetAnalytics = (
  deps: GetGoogleReviewTargetAnalyticsDeps,
) =>
  readTargetAnalytics(
    deps,
    'review',
    'No permission to read Google review targets',
    (query) => deps.targetStore.getGoogleReviewAnalytics(query),
  )

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
