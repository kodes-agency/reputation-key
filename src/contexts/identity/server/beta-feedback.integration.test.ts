// Beta feedback, sent and listed as signed-in members over PostgreSQL and the
// local test Redis, with the real tenant resolution, execution policy, abuse
// budget and triage store. Only Sentry, the monitoring provider, is a fake.
//
// The file runs with every feature switch off: reporting answers to none of
// them, so a manager whose guest pages were stopped can still report that.

import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { betaFeedbackPseudonym } from '#/contexts/identity/application/beta-feedback-pseudonym'
import type { BetaFeedbackInput } from '#/shared/beta-feedback-contract'
import { getEnv } from '#/shared/config/env'
import {
  setupServerFunctionHarness,
  type TestMember,
} from '#/shared/testing/server-function-harness'

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

const NOW = new Date('2026-08-28T08:00:00.000Z')
// A Sentry event id: 32 hex characters, one per delivered report.
const sentryEventId = () => randomBytes(16).toString('hex')

const pseudonym = (
  audience: 'telemetry-actor' | 'telemetry-organization',
  value: string,
) => betaFeedbackPseudonym(getEnv().BETTER_AUTH_SECRET, audience, value)

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  redis: true,
  env: { BETA_CAPABILITIES_OFF: 'google,ai,guest_pages,optional_email' },
  // Triage rows carry pseudonyms, not ids: they are found by the reporter's.
  afterPropertiesCleanup: async (client, { userIds }) => {
    await client.query(
      `DELETE FROM beta_feedback_triage WHERE actor_pseudonym = ANY($1)`,
      [userIds.map((userId) => pseudonym('telemetry-actor', userId))],
    )
  },
})

const bug: BetaFeedbackInput = {
  kind: 'bug',
  impact: 'cannot_complete',
  clientErrorEventId: null,
  maskedLayout: null,
  screenshot: null,
  message: 'The reviews page did not load.',
  routePath: '/properties/private-property-id/reviews',
  viewport: 'wide',
}

const maskedLayout = {
  width: 1280,
  height: 800,
  boxes: [{ x: 0, y: 0, w: 320, h: 48, role: 'heading' as const }],
}

type TriageRow = Readonly<{
  reference: string
  organization_pseudonym: string
  actor_pseudonym: string
  feedback_type: string
  impact_code: string
  route_key: string
  viewport: string
  reporter_role: string
  delivery_state: string
  provider_reference: string | null
  delivery_failure_code: string | null
  attachment_kind: string
  attachment_captured_at: Date | null
  attachment_expires_at: Date | null
}>

async function triageOf(reporter: TestMember): Promise<TriageRow[]> {
  const { rows } = await harness.pool().query<TriageRow>(
    `SELECT reference, organization_pseudonym, actor_pseudonym, feedback_type,
              impact_code, route_key, viewport, reporter_role, delivery_state,
              provider_reference, delivery_failure_code, attachment_kind,
              attachment_captured_at, attachment_expires_at
         FROM beta_feedback_triage WHERE actor_pseudonym = $1`,
    [pseudonym('telemetry-actor', reporter.userId)],
  )
  return rows
}

async function manager(): Promise<TestMember> {
  capture.feedback.mockReset()
  capture.feedback.mockImplementation(sentryEventId)
  const organization = await harness.seedOrganization()
  return harness.seedMember(organization, 'PropertyManager', {
    // An address that does not spell the user id, so the payload check below
    // can tell an id leak from the reporter's own contact.
    email: `ana-${randomUUID()}@example.test`,
  })
}

const submit = (reporter: TestMember | null, data: BetaFeedbackInput = bug) =>
  harness.callAs(reporter, () => submitBetaFeedbackFn({ data }))

describe('submitBetaFeedbackFn', () => {
  it('records a content-free triage row, delivers it and returns its reference', async () => {
    const reporter = await manager()

    const receipt = await submit(reporter)

    const eventId = capture.feedback.mock.results[0]?.value as string
    expect(await triageOf(reporter)).toEqual([
      {
        reference: receipt.reference,
        organization_pseudonym: pseudonym(
          'telemetry-organization',
          reporter.organizationId,
        ),
        actor_pseudonym: pseudonym('telemetry-actor', reporter.userId),
        feedback_type: 'bug',
        impact_code: 'cannot_complete',
        route_key: 'properties.property.reviews',
        viewport: 'wide',
        reporter_role: 'PropertyManager',
        delivery_state: 'delivered',
        provider_reference: eventId,
        delivery_failure_code: null,
        attachment_kind: 'none',
        attachment_captured_at: null,
        attachment_expires_at: null,
      },
    ])
  })

  it('sends monitoring the message and the reporter, tagged by pseudonyms only', async () => {
    const reporter = await manager()

    const { reference } = await submit(reporter)

    expect(capture.feedback).toHaveBeenCalledExactlyOnceWith({
      message: expect.stringContaining('Message: The reviews page did not load.'),
      source: 'repkey-native-beta-feedback',
      attachments: [],
      reporter: { name: 'Harness Member', email: reporter.email },
      tags: {
        feedback_type: 'bug',
        feedback_impact: 'cannot_complete',
        feedback_route: 'properties.property.reviews',
        feedback_actor: pseudonym('telemetry-actor', reporter.userId),
        feedback_organization: pseudonym(
          'telemetry-organization',
          reporter.organizationId,
        ),
        feedback_viewport: 'wide',
        feedback_role: 'PropertyManager',
        feedback_reference: reference,
        feedback_client_error: 'none',
        feedback_attachment: 'none',
        feedback_attachment_retention: 'not_applicable',
        feedback_screenshot: 'none',
        feedback_triage_state: 'new',
        feedback_triage_owner: 'beta_support',
        feedback_triage_severity: 'unclassified',
        feedback_triage_privacy: 'pending',
        feedback_triage_security: 'pending',
        feedback_triage_reproduction: 'pending',
        feedback_triage_dedupe: 'pending',
        feedback_customer_response: 'pending',
      },
    })
    const sent = JSON.stringify(capture.feedback.mock.calls)
    expect(sent).not.toContain('private-property-id')
    expect(sent).not.toContain(reporter.userId)
    expect(sent).not.toContain(reporter.organizationId)
  })

  it('refuses a staff-only login before spending a budget or capturing anything', async () => {
    const reporter = await manager()
    const staff = await harness.seedMember({ id: reporter.organizationId }, 'Member')

    await expect(submit(staff)).rejects.toMatchObject({ code: 'beta_role_inactive' })

    expect(capture.feedback).not.toHaveBeenCalled()
    expect(await triageOf(staff)).toEqual([])
    // The budget was not spent: all five reports of the hour remain.
    for (let report = 0; report < 5; report += 1) await submit(reporter)
  })

  it('refuses a caller with no session', async () => {
    await manager()

    await expect(submit(null)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
    expect(capture.feedback).not.toHaveBeenCalled()
  })

  it('stamps the masked layout retention from the server clock, not the browser', async () => {
    const reporter = await manager()

    const { reference } = await submit(reporter, { ...bug, maskedLayout })

    const [row] = await triageOf(reporter)
    expect(row).toMatchObject({
      attachment_kind: 'masked_layout_v1',
      attachment_captured_at: NOW,
      // Exactly the accepted 30-day horizon, derived here rather than
      // anywhere a client clock could reach.
      attachment_expires_at: new Date('2026-09-27T08:00:00.000Z'),
    })
    const { rows } = await harness.pool().query(
      `SELECT viewport_width, viewport_height, box_count, boxes, expires_at
           FROM beta_feedback_masked_layouts WHERE feedback_reference = $1`,
      [reference],
    )
    expect(rows).toEqual([
      {
        viewport_width: 1280,
        viewport_height: 800,
        box_count: 1,
        boxes: maskedLayout.boxes,
        expires_at: new Date('2026-09-27T08:00:00.000Z'),
      },
    ])
  })

  it('tells monitoring a layout exists without sending the geometry', async () => {
    const reporter = await manager()

    await submit(reporter, { ...bug, maskedLayout })

    const captured = capture.feedback.mock.calls[0]?.[0] as {
      message: string
      tags: Record<string, string>
    }
    expect(captured.tags.feedback_attachment).toBe('masked_layout_v1')
    expect(captured.tags.feedback_attachment_retention).toBe('expires_30d')
    // A shape summary only; the rectangles stay first-party.
    expect(captured.message).toContain('Masked layout: 1280x800 heading=1')
    expect(captured.message).not.toContain('"x"')
  })

  it('refuses the sixth report of the hour with its own 429, recording nothing', async () => {
    const reporter = await manager()
    for (let report = 0; report < 5; report += 1) await submit(reporter)
    capture.feedback.mockClear()

    await expect(submit(reporter)).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'rate_limited',
      status: 429,
    })

    expect(capture.feedback).not.toHaveBeenCalled()
    expect(await triageOf(reporter)).toHaveLength(5)
  })

  it('keeps one manager’s spent budget from refusing another of the same Organization', async () => {
    const reporter = await manager()
    const colleague = await harness.seedMember(
      { id: reporter.organizationId },
      'AccountAdmin',
    )
    for (let report = 0; report < 5; report += 1) await submit(reporter)

    await expect(submit(colleague)).resolves.toEqual({ reference: expect.any(String) })
  })

  it('answers a stable unavailable response, and records the failure, when monitoring is down', async () => {
    const reporter = await manager()
    capture.feedback.mockReturnValue(undefined)

    await expect(submit(reporter)).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'temporarily_unavailable',
      status: 503,
    })
    expect(await triageOf(reporter)).toEqual([
      expect.objectContaining({
        delivery_state: 'failed',
        provider_reference: null,
        delivery_failure_code: 'monitoring_unavailable',
      }),
    ])
  })

  it('keeps a malformed provider receipt out of the delivered state', async () => {
    const reporter = await manager()
    capture.feedback.mockReturnValue('not-a-provider-event-id')

    await expect(submit(reporter)).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'temporarily_unavailable',
      status: 503,
    })
    expect(await triageOf(reporter)).toEqual([
      expect.objectContaining({
        delivery_state: 'failed',
        provider_reference: null,
        delivery_failure_code: 'monitoring_invalid_reference',
      }),
    ])
  })
})

describe('listMyBetaFeedbackFn', () => {
  it('lists the caller’s own reports and none of a colleague’s', async () => {
    const reporter = await manager()
    const colleague = await harness.seedMember(
      { id: reporter.organizationId },
      'AccountAdmin',
    )
    const { reference } = await submit(reporter)
    await submit(colleague)

    const reports = await harness.callAs(reporter, () => listMyBetaFeedbackFn())

    expect(reports).toEqual([
      expect.objectContaining({
        reference,
        feedbackType: 'bug',
        impactCode: 'cannot_complete',
        routeKey: 'properties.property.reviews',
        deliveryState: 'delivered',
        triageState: 'new',
      }),
    ])
  })

  it('returns nothing rather than failing when the reporter has no reports', async () => {
    const reporter = await manager()

    await expect(harness.callAs(reporter, () => listMyBetaFeedbackFn())).resolves.toEqual(
      [],
    )
  })

  it('refuses a staff-only login', async () => {
    const reporter = await manager()
    const staff = await harness.seedMember({ id: reporter.organizationId }, 'Member')

    await expect(
      harness.callAs(staff, () => listMyBetaFeedbackFn()),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })
})
