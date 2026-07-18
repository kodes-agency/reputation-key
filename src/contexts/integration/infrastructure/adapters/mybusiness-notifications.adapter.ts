// Integration context — My Business Notifications HTTP adapter (step 2/3).
// Mirrors gbp-api.adapter.ts: fetch with Bearer token, classify HTTP status into
// a domain error kind at the boundary (cc-errors §13 — raw status never crosses),
// zod-validate at the boundary. Implements MyBusinessNotificationsPort.
//
// Google's documented delete path is PATCH with `updateMask=pubsubTopic` and an
// empty `pubsubTopic` string, which clears the subscription.

import type { MyBusinessNotificationsPort } from '../../application/ports/mybusiness-notifications.port'
import { createGbpApiError } from '../../domain/gbp-api-error'
import type { GbpApiErrorKind } from '../../domain/gbp-api-error'
import { trace } from '#/shared/observability/trace'

const classifyHttpStatus = (status: number): GbpApiErrorKind => {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  return 'upstream_error'
}

// BQC-4.3: base URL from the composition root's providerConfigFor mapping —
// no hardcoded or fallback endpoint (ADR 0031/0048).
export const createMyBusinessNotificationsAdapter = (config: {
  baseUrl: string
}): MyBusinessNotificationsPort => {
  const baseUrl = config.baseUrl
  const subscribe: MyBusinessNotificationsPort['subscribe'] = async (input) => {
    const url = `${baseUrl}/accounts/${input.gbpAccountId}/notificationSetting`
    const response = await trace('mybusinessNotifications.subscribe', () =>
      fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `accounts/${input.gbpAccountId}/notificationSetting`,
          pubsubTopic: input.pubsubTopic,
          notificationTypes: [...input.notificationTypes],
        }),
      }),
    )
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unable to read response body')
      throw createGbpApiError('subscribe', classifyHttpStatus(response.status), errorText)
    }
    // Drain the body so the connection can be reused; payload is unused.
    await response.text().catch(() => undefined)
  }

  const unsubscribe: MyBusinessNotificationsPort['unsubscribe'] = async (input) => {
    const url = `${baseUrl}/accounts/${input.gbpAccountId}/notificationSetting?updateMask=pubsubTopic`
    const response = await trace('mybusinessNotifications.unsubscribe', () =>
      fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `accounts/${input.gbpAccountId}/notificationSetting`,
          pubsubTopic: '',
        }),
      }),
    )
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unable to read response body')
      throw createGbpApiError(
        'unsubscribe',
        classifyHttpStatus(response.status),
        errorText,
      )
    }
    await response.text().catch(() => undefined)
  }

  return { subscribe, unsubscribe }
}
