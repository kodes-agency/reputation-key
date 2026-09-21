import { describe, expect, it } from 'vitest'
import { isStaleQueuedEmail } from './email-freshness'

const NOW = new Date('2026-09-22T12:00:00.000Z')
const HOUR = 60 * 60_000
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR)

const queued = (
  overrides: Partial<Parameters<typeof isStaleQueuedEmail>[0]> = {},
): Parameters<typeof isStaleQueuedEmail>[0] => ({
  category: 'urgent_operational',
  cadence: 'immediate',
  createdAt: ago(1),
  notBefore: null,
  ...overrides,
})

describe('queued email freshness', () => {
  it('keeps immediate mail worth sending for a day after it was queued, and no longer', () => {
    expect(isStaleQueuedEmail(queued({ createdAt: ago(23) }), NOW)).toBe(false)
    expect(isStaleQueuedEmail(queued({ createdAt: ago(25) }), NOW)).toBe(true)
    // An Organization admitted to email after two months dark.
    expect(isStaleQueuedEmail(queued({ createdAt: ago(60 * 24) }), NOW)).toBe(true)
  })

  it('counts from the end of a quiet-hours deferral, which a recipient chose', () => {
    expect(
      isStaleQueuedEmail(queued({ createdAt: ago(30), notBefore: ago(0.1) }), NOW),
    ).toBe(false)
    expect(
      isStaleQueuedEmail(queued({ createdAt: ago(50), notBefore: ago(25) }), NOW),
    ).toBe(true)
  })

  it('gives a digest row two days: a full digest cycle plus quiet hours', () => {
    const daily = (hours: number) =>
      queued({
        category: 'workflow_collaboration',
        cadence: 'daily',
        createdAt: ago(hours),
      })

    expect(isStaleQueuedEmail(daily(47), NOW)).toBe(false)
    expect(isStaleQueuedEmail(daily(49), NOW)).toBe(true)
  })

  it('gives a mandatory Organization notice a week', () => {
    const mandatory = (hours: number) =>
      queued({ category: 'mandatory', createdAt: ago(hours) })

    expect(isStaleQueuedEmail(mandatory(6 * 24), NOW)).toBe(false)
    expect(isStaleQueuedEmail(mandatory(8 * 24), NOW)).toBe(true)
  })

  it('never calls a row stale before it was queued', () => {
    expect(
      isStaleQueuedEmail(queued({ createdAt: new Date(NOW.getTime() + HOUR) }), NOW),
    ).toBe(false)
  })
})
