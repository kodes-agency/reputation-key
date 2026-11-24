import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  getPrivateFeedbackTargetAnalyticsDto,
  getResponseTargetPolicySettingsDto,
  setResponseTargetPolicyDto,
} from '../inbox/contracts'
import { runInboxCommand } from './inbox-command'
import { createServerFn } from '@tanstack/react-start'
import { propertyId } from '#/shared/domain/ids'

const scopeOf = (data: { propertyId?: string }) =>
  data.propertyId ? { propertyId: propertyId(data.propertyId) } : {}

export const getResponseTargetPolicySettingsFn = createServerFn({ method: 'GET' })
  .validator(getResponseTargetPolicySettingsDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('organization.update', (inbox, ctx) =>
          inbox.getResponseTargetPolicySettings(scopeOf(data), ctx),
        ),
      'GET',
      'inbox.getResponseTargetPolicySettings',
    ),
  )

export const getPrivateFeedbackTargetAnalyticsFn = createServerFn({ method: 'GET' })
  .validator(getPrivateFeedbackTargetAnalyticsDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.read', (inbox, ctx) =>
          inbox.getPrivateFeedbackTargetAnalytics(scopeOf(data), ctx),
        ),
      'GET',
      'inbox.getPrivateFeedbackTargetAnalytics',
    ),
  )

export const getGoogleReviewTargetAnalyticsFn = createServerFn({ method: 'GET' })
  .validator(getPrivateFeedbackTargetAnalyticsDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.read', (inbox, ctx) =>
          inbox.getGoogleReviewTargetAnalytics(scopeOf(data), ctx),
        ),
      'GET',
      'inbox.getGoogleReviewTargetAnalytics',
    ),
  )

export const setResponseTargetPolicyFn = createServerFn({ method: 'POST' })
  .validator(setResponseTargetPolicyDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('organization.update', (inbox, ctx) =>
          inbox.setResponseTargetPolicy(
            data.scope === 'property'
              ? { ...data, propertyId: propertyId(data.propertyId) }
              : data,
            ctx,
          ),
        ),
      'POST',
      'inbox.setResponseTargetPolicy',
    ),
  )
