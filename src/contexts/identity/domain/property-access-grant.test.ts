import { describe, expect, it } from 'vitest'
import { decidePropertyGrant } from './property-access-grant'

const NOW = new Date('2026-07-17T12:00:00Z')
const EARLIER = new Date(NOW.getTime() - 60_000)
const FRIDAY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
const NEXT_WEEK = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)

const decide = (
  current: Readonly<{ expiresAt: Date | null }> | null,
  expiresAt: Date | null,
  replacesActiveTerm: boolean,
) => decidePropertyGrant({ current, expiresAt, replacesActiveTerm, now: NOW })

describe('decidePropertyGrant', () => {
  it.each([
    ['the operator grant', true],
    ['the Members edit', false],
  ])('inserts when nothing holds the slot (%s)', (_label, replacesActiveTerm) => {
    expect(decide(null, null, replacesActiveTerm)).toBe('insert')
  })

  it.each([
    ['the operator grant', true],
    ['the Members edit', false],
  ])('supersedes a lapsed grant (%s)', (_label, replacesActiveTerm) => {
    expect(decide({ expiresAt: EARLIER }, null, replacesActiveTerm)).toBe('supersede')
    // A grant lapses at its expiry instant, the bound every access read uses.
    expect(decide({ expiresAt: NOW }, FRIDAY, replacesActiveTerm)).toBe('supersede')
  })

  it.each([
    ['a permanent grant asked again', null, null],
    ['a temporary grant asked again with its own expiry', FRIDAY, new Date(FRIDAY)],
  ])('keeps %s', (_label, currentExpiresAt, expiresAt) => {
    expect(decide({ expiresAt: currentExpiresAt }, expiresAt, true)).toBe('keep')
  })

  it.each([
    ['a later expiry', FRIDAY, NEXT_WEEK],
    ['no expiry', FRIDAY, null],
    ['an earlier expiry', NEXT_WEEK, FRIDAY],
    ['an expiry where there was none', null, FRIDAY],
  ])(
    'supersedes an active grant the operator gives %s',
    (_label, currentExpiresAt, expiresAt) => {
      expect(decide({ expiresAt: currentExpiresAt }, expiresAt, true)).toBe('supersede')
    },
  )

  it.each([
    ['temporary', FRIDAY],
    ['permanent', null],
  ])('keeps an active %s grant for the Members edit', (_label, currentExpiresAt) => {
    expect(decide({ expiresAt: currentExpiresAt }, null, false)).toBe('keep')
  })
})
