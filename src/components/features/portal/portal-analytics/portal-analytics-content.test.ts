import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PortalAnalyticsContent } from './portal-analytics-content'
import { RESULTS_HEALTHY } from './portal-results-stories-data'

vi.mock('../portal-detail/use-portal-edit-access', () => ({
  usePortalEditAccess: () => ({ canEdit: false }),
}))

describe('Results for a Portal that skips ratings', () => {
  it.each([false, true])(
    'explains the switch and keeps history: %s',
    (skipPrivateRating) => {
      const html = renderToStaticMarkup(
        createElement(PortalAnalyticsContent, {
          data: RESULTS_HEALTHY,
          timeRange: '30d',
          onTimeRangeChange: () => undefined,
          place: {
            propertyId: 'p',
            portalId: 'q',
            isLive: true,
            scansCounted: true,
            canOpenInbox: false,
            skipPrivateRating,
          },
        }),
      )
      expect(
        html.includes(
          'This portal skips the private rating, so it collects no new ratings or notes.',
        ),
      ).toBe(skipPrivateRating)
      expect(html).toContain('Are they happy?')
    },
  )
})
