import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { GuestVoiceSummaryPlan } from './plan-guest-voice-summary'
import {
  createRunGuestVoiceSummarySweep,
  GUEST_VOICE_SUMMARY_SWEEP_LIMIT,
  GuestVoiceSummarySweepError,
} from './run-guest-voice-summary-sweep'

const NOW = Date.UTC(2026, 10, 9, 8, 5)
const ORG = organizationId('org-sweep')
const PROPERTIES = [0, 1, 2, 3].map((n) =>
  propertyId(`7000000${n}-0000-4000-8000-000000000001`),
)

const SEND: GuestVoiceSummaryPlan = {
  status: 'send',
  summaryKind: 'weekly',
  localDate: '2026-11-09',
  window: '90d',
  startLocalDate: '2026-08-12',
  endLocalDate: '2026-11-09',
  lines: [],
}

function harness(
  plans: Readonly<Record<string, GuestVoiceSummaryPlan | Error>>,
  published: Readonly<Record<string, boolean>> = {},
) {
  const schedule = {
    listDue: vi.fn(async () =>
      PROPERTIES.map((property) => ({ organizationId: ORG, propertyId: property })),
    ),
    publish: vi.fn(
      async ({ propertyId: property }: { propertyId: string }) =>
        published[property] ?? true,
    ),
  }
  const plan = vi.fn(async ({ propertyId: property }: { propertyId: string }) => {
    const planned = plans[property] ?? ({ status: 'quiet' } as const)
    if (planned instanceof Error) throw planned
    return planned
  })
  const logger = { warn: vi.fn() }
  const sweep = createRunGuestVoiceSummarySweep({
    schedule: schedule as never,
    plan: plan as never,
    nowEpochMillis: () => NOW,
    logger,
  })
  return { sweep, schedule, plan, logger }
}

const allow = async () => true

describe('the Monday sweep', () => {
  it('asks for the Properties whose Monday morning it is, a bounded number of them', async () => {
    const { sweep, schedule } = harness({})

    await sweep({ authorizeScope: allow })

    expect(schedule.listDue).toHaveBeenCalledWith({
      nowEpochMillis: NOW,
      limit: GUEST_VOICE_SUMMARY_SWEEP_LIMIT,
    })
  })

  it('records a fact only for a Property whose plan says to send, and counts the rest', async () => {
    const [sends, quiet, skipped, alsoSends] = PROPERTIES
    const { sweep, schedule } = harness({
      [sends!]: SEND,
      [quiet!]: { status: 'quiet' },
      [skipped!]: { status: 'skipped', why: 'not_v3' },
      [alsoSends!]: SEND,
    })

    const stats = await sweep({ authorizeScope: allow })

    expect(stats).toEqual({
      inspected: 4,
      sent: 2,
      alreadySent: 0,
      quiet: 1,
      skipped: 1,
      denied: 0,
      failed: 0,
    })
    expect(schedule.publish).toHaveBeenCalledTimes(2)
    expect(schedule.publish).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: sends,
      plan: SEND,
      occurredAt: new Date(NOW),
    })
  })

  it('says a Monday already recorded by an earlier sweep is not recorded again', async () => {
    const [first] = PROPERTIES
    const { sweep } = harness({ [first!]: SEND }, { [first!]: false })

    const stats = await sweep({ authorizeScope: allow })

    expect(stats).toMatchObject({ sent: 0, alreadySent: 1 })
  })

  it('decides each Property under current policy before reading anything of it', async () => {
    const [first, second] = PROPERTIES
    const authorizeScope = vi.fn(
      async (_org: unknown, property: string) => property !== first,
    )
    const { sweep, plan, schedule } = harness({ [second!]: SEND })

    const stats = await sweep({ authorizeScope })

    expect(stats.denied).toBe(1)
    expect(authorizeScope).toHaveBeenCalledTimes(4)
    expect(plan).not.toHaveBeenCalledWith(expect.objectContaining({ propertyId: first }))
    expect(schedule.publish).toHaveBeenCalledTimes(1)
  })

  it('goes on past a Property that fails, then fails the run so the queue retries it', async () => {
    const [first, second] = PROPERTIES
    const { sweep, schedule, logger } = harness({
      [first!]: new Error('Review could not be read'),
      [second!]: SEND,
    })

    const outcome = sweep({ authorizeScope: allow })

    await expect(outcome).rejects.toBeInstanceOf(GuestVoiceSummarySweepError)
    await expect(outcome).rejects.toMatchObject({
      stats: { failed: 1, sent: 1, inspected: 4 },
    })
    expect(schedule.publish).toHaveBeenCalledTimes(1)
    // Logged by count: no tenant identifier is a log field.
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('org-sweep')
  })

  it('fails the run when current policy cannot be read for a Property', async () => {
    const { sweep } = harness({})

    await expect(
      sweep({
        authorizeScope: async () => {
          throw new Error('policy store unavailable')
        },
      }),
    ).rejects.toBeInstanceOf(GuestVoiceSummarySweepError)
  })

  it('does nothing when no Property is due', async () => {
    const { sweep, schedule, plan } = harness({})
    schedule.listDue.mockResolvedValue([])

    await expect(sweep({ authorizeScope: allow })).resolves.toMatchObject({
      inspected: 0,
    })
    expect(plan).not.toHaveBeenCalled()
  })
})
