// Beta feedback with every capability switched off: the report and the list
// are refused and nothing reaches monitoring.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

const capture = vi.hoisted(() => ({ feedback: vi.fn() }))

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
vi.mock('#/shared/observability/telemetry', async (importActual) => ({
  ...(await importActual<typeof import('#/shared/observability/telemetry')>()),
  captureObservabilityFeedback: capture.feedback,
}))

import { listMyBetaFeedbackFn, submitBetaFeedbackFn } from './beta-feedback'

const harness = setupServerFunctionHarness({ env: { BETA_CAPABILITIES_OFF: 'all' } })

describe('beta feedback while every capability is off', () => {
  it('refuses a report and captures nothing', async () => {
    const organization = await harness.seedOrganization()
    const reporter = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(reporter, () =>
        submitBetaFeedbackFn({
          data: {
            kind: 'bug',
            impact: 'cannot_complete',
            clientErrorEventId: null,
            maskedLayout: null,
            screenshot: null,
            message: 'The reviews page did not load.',
            routePath: '/properties/private-property-id/reviews',
            viewport: 'wide',
          },
        }),
      ),
    ).rejects.toMatchObject({ name: 'AuthError', status: 403 })
    expect(capture.feedback).not.toHaveBeenCalled()
  })

  it('refuses the list', async () => {
    const organization = await harness.seedOrganization()
    const reporter = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(reporter, () => listMyBetaFeedbackFn()),
    ).rejects.toMatchObject({ name: 'AuthError', status: 403 })
  })
})
