import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { ConsumerEvent } from '#/shared/outbox'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import {
  guestVoiceSummaryResourceId,
  handleAiGuestVoiceSummaryReady,
  ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER,
  registerAiGuestVoiceSummaryNoticeConsumer,
} from './ai-guest-voice-summary-notice-consumers'
import { parseNotificationPayload } from '../domain/notification-payload'
import { renderNotification } from '../domain/notification-templates'

const IDS = {
  event: '94000000-0000-4000-8000-000000000001',
  property: '94000000-0000-4000-8000-000000000002',
  issue: '94000000-0000-4000-8000-000000000003',
} as const
const ORG = 'organization-guest-voice-summary'
const ADMIN = userId('admin-guest-voice-summary')
const MANAGER = userId('manager-guest-voice-summary')
const OUTSIDER = userId('manager-without-access')

const FACT_LINES = [
  {
    kind: 'fix_first',
    topic: 'facilities_equipment',
    issueId: IDS.issue,
    reviewCount: 19,
    textReviewCount: 128,
    upTo: 0.2,
    change: null,
    polarity: null,
  },
  {
    kind: 'protect',
    topic: 'staff_service',
    issueId: null,
    reviewCount: 61,
    textReviewCount: 128,
    upTo: null,
    change: null,
    polarity: null,
  },
  {
    kind: 'change',
    topic: 'cleanliness',
    issueId: null,
    reviewCount: 12,
    textReviewCount: 128,
    upTo: null,
    change: 'rising',
    polarity: 'complaint',
  },
]

const event = (
  payloadOverrides: Readonly<Record<string, unknown>> = {},
  envelopeOverrides: Partial<ConsumerEvent> = {},
): ConsumerEvent => ({
  eventId: IDS.event,
  eventType: 'ai.guest_voice_summary.ready',
  eventVersion: 1,
  payload: {
    organizationId: ORG,
    propertyId: IDS.property,
    summaryKind: 'weekly',
    localDate: '2026-11-02',
    window: '90d',
    startLocalDate: '2026-08-05',
    endLocalDate: '2026-11-02',
    lines: FACT_LINES,
    occurredAt: '2026-11-02T08:05:00.000Z',
    ...payloadOverrides,
  },
  organizationId: ORG,
  propertyId: IDS.property,
  sourceContext: 'ai',
  sourceAggregateId: IDS.property,
  recordedAt: '2026-11-02T08:05:00.000Z',
  ...envelopeOverrides,
})

const makeDeps = () => {
  const jobs: Array<{ name: string; data: Record<string, unknown>; opts?: unknown }> = []
  const receipts: Array<[string, string, string]> = []
  const eligible = new Set<string>([ADMIN, MANAGER])
  return {
    jobs,
    receipts,
    deps: {
      queue: {
        add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
          jobs.push({ name, data: data as Record<string, unknown>, opts })
        }),
      },
      userLookup: {
        findByRole: vi.fn(async (_org: unknown, role: string) =>
          role === 'AccountAdmin' ? [ADMIN] : [MANAGER, OUTSIDER],
        ),
      },
      responsibleManagers: {
        isEligibleForProperty: vi.fn(
          async (_org: unknown, _property: unknown, user: string) => eligible.has(user),
        ),
      },
      activeProperty: vi.fn(async () => true),
      displayNames: { findPropertyName: vi.fn(async () => 'Seaview Hotel') },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      },
      receipts: {
        insertReceipt: async (eventId: string, consumer: string, status: string) => {
          receipts.push([eventId, consumer, status])
        },
      },
    },
  }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(() => {
  clearEventSchemas()
})

describe('the Monday email route', () => {
  it('registers the one fact the AI context writes per Property per Monday', () => {
    const registry = createConsumerRegistry()

    registerAiGuestVoiceSummaryNoticeConsumer(registry, makeDeps().deps as never)

    expect(registry.list()).toEqual([
      {
        eventType: 'ai.guest_voice_summary.ready',
        consumerName: ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER,
      },
    ])
  })

  it('queues one notice per manager who may use the Property, keyed by the fact', async () => {
    const { deps, jobs, receipts } = makeDeps()

    await expect(handleAiGuestVoiceSummaryReady(deps as never, event())).resolves.toEqual(
      {
        status: 'applied',
      },
    )

    expect(jobs.map(({ name, opts }) => ({ name, opts }))).toEqual(
      [ADMIN, MANAGER].map((recipient) => ({
        name: 'insert-notification',
        opts: { jobId: `${IDS.event}-${recipient}` },
      })),
    )
    for (const job of jobs) {
      expect(job.data).toMatchObject({
        organizationId: ORG,
        propertyId: IDS.property,
        type: 'guest_voice.summary',
        resourceType: 'property',
        // Each Monday its own unread key, so last week's unread row never absorbs it.
        resourceId: `${IDS.property}:2026-11-02`,
        eventId: IDS.event,
        audience: { kind: 'property_operator' },
      })
    }
    expect(receipts).toEqual([
      [IDS.event, ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER, 'applied'],
    ])
  })

  it('leaves out a manager who cannot use the Property (access is asked, not assumed)', async () => {
    const { deps, jobs } = makeDeps()

    await handleAiGuestVoiceSummaryReady(deps as never, event())

    expect(jobs.map((job) => job.data.userId)).not.toContain(OUTSIDER)
    expect(deps.responsibleManagers.isEligibleForProperty).toHaveBeenCalledWith(
      ORG,
      IDS.property,
      OUTSIDER,
    )
  })

  it('states the fact’s lines as the page has them, in hundredths of a star, with no issue id', async () => {
    const { deps, jobs } = makeDeps()

    await handleAiGuestVoiceSummaryReady(deps as never, event())

    const payload = jobs[0]?.data.payload as Record<string, unknown>
    expect(payload).toEqual({
      propertyName: 'Seaview Hotel',
      guestVoiceKind: 'weekly',
      guestVoiceWindow: '90d',
      guestVoiceLines: [
        {
          kind: 'fix_first',
          topic: 'facilities_equipment',
          reviewCount: 19,
          textReviewCount: 128,
          upToHundredths: 20,
        },
        {
          kind: 'protect',
          topic: 'staff_service',
          reviewCount: 61,
          textReviewCount: 128,
        },
        {
          kind: 'change',
          topic: 'cleanliness',
          reviewCount: 12,
          textReviewCount: 128,
          change: 'rising',
          polarity: 'complaint',
        },
      ],
    })
    expect(JSON.stringify(payload)).not.toContain(IDS.issue)
    // The notice the reader gets says it in words, from the same payload.
    expect(
      renderNotification('guest_voice.summary', parseNotificationPayload(payload)).title,
    ).toBe('Your Guest voice this week at Seaview Hotel')
  })

  it('carries the monthly roundup the same way, even with nothing to name', async () => {
    const { deps, jobs } = makeDeps()

    await expect(
      handleAiGuestVoiceSummaryReady(
        deps as never,
        event({ summaryKind: 'monthly', lines: [] }),
      ),
    ).resolves.toEqual({ status: 'applied' })

    const payload = jobs[0]?.data.payload as Record<string, unknown>
    expect(payload.guestVoiceKind).toBe('monthly')
    expect(payload.guestVoiceLines).toEqual([])
  })

  it('is obsolete, and queues nothing, for an archived Property', async () => {
    const { deps, jobs, receipts } = makeDeps()
    deps.activeProperty.mockResolvedValue(false)

    await expect(handleAiGuestVoiceSummaryReady(deps as never, event())).resolves.toEqual(
      {
        status: 'obsolete',
      },
    )

    expect(jobs).toEqual([])
    expect(receipts).toEqual([
      [IDS.event, ON_AI_GUEST_VOICE_SUMMARY_READY_CONSUMER, 'obsolete'],
    ])
  })

  it('is obsolete when no manager may use the Property', async () => {
    const { deps, jobs } = makeDeps()
    deps.responsibleManagers.isEligibleForProperty.mockResolvedValue(false)

    await expect(handleAiGuestVoiceSummaryReady(deps as never, event())).resolves.toEqual(
      {
        status: 'obsolete',
      },
    )
    expect(jobs).toEqual([])
  })

  it('names a Monday by the Property and the day', () => {
    expect(guestVoiceSummaryResourceId(IDS.property, '2026-11-09')).toBe(
      `${IDS.property}:2026-11-09`,
    )
  })

  describe('refuses a fact it cannot trust', () => {
    it('rejects a different event type', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiGuestVoiceSummaryReady(
          deps as never,
          event({}, { eventType: 'review.created' }),
        ),
      ).rejects.toThrow(/wrong event type/)
    })

    it('rejects an envelope that names another Organization', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiGuestVoiceSummaryReady(
          deps as never,
          event({}, { organizationId: 'other' }),
        ),
      ).rejects.toThrow(/attribution mismatch/)
    })

    it('rejects a line with a topic that is not one of the twelve', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiGuestVoiceSummaryReady(
          deps as never,
          event({ lines: [{ ...FACT_LINES[0], topic: 'air_conditioning' }] }),
        ),
      ).rejects.toThrow()
    })

    it('rejects more than three lines', async () => {
      const { deps } = makeDeps()

      await expect(
        handleAiGuestVoiceSummaryReady(
          deps as never,
          event({ lines: [...FACT_LINES, FACT_LINES[0]] }),
        ),
      ).rejects.toThrow()
    })
  })
})
