// OBS-01 — one executable synthetic marker crosses every local outbound
// observability/fact boundary. This does not replace the deployed Sentry
// acceptance drill; it proves the repository-owned denials cannot silently
// drift independently between logs, traces, metrics, durable facts, and beta
// feedback attachments.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod/v4'
import type { DomainEvent } from '#/shared/events/events'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { betaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
import {
  buildMaskedLayoutSnapshot,
  renderMaskedLayoutSvg,
} from '#/shared/masked-layout-snapshot'
import {
  METRIC_DEFINITIONS,
  labelValueAllowed,
} from '#/shared/observability/metrics-schema'
import { scrubSentryEvent } from '#/shared/observability/telemetry'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
}))

vi.mock('#/shared/observability/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/shared/observability/logger')>()),
  getLogger: () => logger,
}))

import { sanitizeTelemetryValue } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

const SECRET = 'obs-canary-secret-7f2a@example.invalid'
const REVIEW = 'obs-canary-private-review-7f2a'
const CONTACT = 'obs-canary-contact-7f2a@example.invalid'
const MARKERS = [SECRET, REVIEW, CONTACT] as const

function expectNoMarkers(value: unknown): void {
  const serialized = JSON.stringify(value)
  for (const marker of MARKERS) expect(serialized).not.toContain(marker)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearEventSchemas()
  registerAllEventSchemas()
})

describe('OBS-01 synthetic privacy exfiltration canary', () => {
  it('removes the markers from structured logs, trace failures, and Sentry events', async () => {
    expectNoMarkers(
      sanitizeTelemetryValue({
        password: SECRET,
        reviewText: REVIEW,
        contactEmail: CONTACT,
      }),
    )

    const failure = Object.assign(new Error(SECRET), {
      reviewText: REVIEW,
      contactEmail: CONTACT,
    })
    await expect(
      trace('privacy.exfiltration_canary', async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expectNoMarkers(logger.error.mock.calls)

    expectNoMarkers(
      scrubSentryEvent({
        message: REVIEW,
        exception: { values: [{ type: 'Error', value: SECRET }] },
        request: { method: 'POST', data: { contact: CONTACT } },
        user: { email: CONTACT },
        attachments: [{ filename: REVIEW, bytes: SECRET }],
      }),
    )
  })

  it('keeps metric labels closed to content and tenant field names', () => {
    const forbiddenLabels = [
      'organizationId',
      'propertyId',
      'userId',
      'reviewText',
      'contactEmail',
      'password',
    ]
    for (const definition of METRIC_DEFINITIONS) {
      for (const [label, specification] of Object.entries(definition.labels)) {
        expect(forbiddenLabels, definition.name).not.toContain(label)
        expect(labelValueAllowed(specification, SECRET), definition.name).toBe(false)
        expect(labelValueAllowed(specification, REVIEW), definition.name).toBe(false)
        expect(labelValueAllowed(specification, CONTACT), definition.name).toBe(false)
      }
    }
  })

  it('strips the markers before a domain fact enters the durable outbox', () => {
    const row = toOutboxEvent({
      _tag: 'review.created',
      eventId: '00000000-0000-4000-8000-000000000001',
      reviewId: reviewId('00000000-0000-4000-8000-000000000002'),
      organizationId: organizationId('00000000-0000-4000-8000-000000000003'),
      propertyId: propertyId('00000000-0000-4000-8000-000000000004'),
      platform: 'google',
      sourceEpoch: 1,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: new Date('2026-08-28T00:00:00.000Z'),
      correlationId: null,
      reviewText: REVIEW,
      reviewerName: CONTACT,
      password: SECRET,
    } as DomainEvent)

    expectNoMarkers(row)
    expect(row.payload).not.toHaveProperty('reviewText')
    expect(row.payload).not.toHaveProperty('reviewerName')
    expect(row.payload).not.toHaveProperty('password')
  })

  it('rejects pixel/replay material and permits only a content-free masked layout', () => {
    expect(() =>
      betaFeedbackInputSchema.parse({
        type: 'bug',
        title: 'A reproducible problem',
        expected: 'The action should finish.',
        actual: 'The action remains pending.',
        impact: 'small_issue',
        routePath: '/home',
        viewport: 'regular',
        screenshot: `data:image/png;base64,${SECRET}`,
        replay: { reviewText: REVIEW, contact: CONTACT },
      }),
    ).toThrow(ZodError)

    const attachment = buildMaskedLayoutSnapshot(
      [
        { kind: 'text', left: 0, top: 0, right: 300, bottom: 30 },
        { kind: 'input', left: 0, top: 40, right: 300, bottom: 80 },
      ],
      { width: 1_000, height: 800 },
    )
    const parsed = betaFeedbackInputSchema.parse({
      type: 'bug',
      title: 'A reproducible problem',
      expected: 'The action should finish.',
      actual: 'The action remains pending.',
      impact: 'small_issue',
      routePath: '/home',
      viewport: 'regular',
      attachment,
    })
    expect(parsed).toMatchObject({ type: 'bug', attachment })
    if (parsed.type !== 'bug') throw new Error('expected Bug feedback fixture')
    expectNoMarkers(parsed.attachment)
    expectNoMarkers(renderMaskedLayoutSvg(parsed.attachment!))
  })
})
