import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPhoneWidthBaseline,
  type PhoneWidthBaselineEntry,
} from './phone-width-baseline'
import type { PhoneWidthMeasurement } from '../src/shared/testing/phone-width'

const story = { storyId: 'forms-save--pending', state: 'Pending' }
const fits: readonly PhoneWidthMeasurement[] = [
  { width: 320, overflow: [], targets: [] },
  { width: 390, overflow: [], targets: [] },
]
const tooSmall: readonly PhoneWidthMeasurement[] = [
  { width: 320, overflow: [], targets: ['Save is 60x36; a target is at least 44 px'] },
  fits[1]!,
]
const baseline: readonly PhoneWidthBaselineEntry[] = [
  { ...story, width: 320, checks: ['targets'] },
]

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('phone-width baseline', () => {
  it('requires an unlisted state to pass both checks at both widths', () => {
    expect(() => assertPhoneWidthBaseline(story, fits, [])).not.toThrow()
    expect(() => assertPhoneWidthBaseline(story, tooSmall, [])).toThrow(
      /forms-save--pending.*Pending.*320 px.*targets/s,
    )
  })

  it('accepts a recorded failure only for its story, state, width and check', () => {
    expect(() => assertPhoneWidthBaseline(story, tooSmall, baseline)).not.toThrow()
    expect(() =>
      assertPhoneWidthBaseline(
        { ...story, storyId: 'forms-save--new' },
        tooSmall,
        baseline,
      ),
    ).toThrow(/Save is 60x36/)
    expect(() =>
      assertPhoneWidthBaseline({ ...story, state: 'Error' }, tooSmall, baseline),
    ).toThrow(/Save is 60x36/)
  })

  it('rejects overflow even when targets already fail for that state', () => {
    const measurements = [
      { ...tooSmall[0]!, overflow: ['the page scrolls sideways: 500 px wide in 320 px'] },
      fits[1]!,
    ]
    expect(() => assertPhoneWidthBaseline(story, measurements, baseline)).toThrow(
      /320 px.*overflow.*the page scrolls sideways/s,
    )
  })

  it('rejects a failure at another width even when that check is recorded', () => {
    const measurements = [tooSmall[0]!, { ...tooSmall[0]!, width: 390 as const }]
    expect(() => assertPhoneWidthBaseline(story, measurements, baseline)).toThrow(
      /390 px.*targets/s,
    )
  })

  it('reports every listed check that passes without failing', () => {
    const both: readonly PhoneWidthBaselineEntry[] = [
      { ...story, width: 320, checks: ['overflow', 'targets'] },
      { ...story, width: 390, checks: ['overflow', 'targets'] },
    ]
    const passing = [
      'forms-save--pending (Pending), 320 px, overflow',
      'forms-save--pending (Pending), 320 px, targets',
      'forms-save--pending (Pending), 390 px, overflow',
      'forms-save--pending (Pending), 390 px, targets',
    ]
    expect(assertPhoneWidthBaseline(story, fits, both)).toEqual(passing)
    expect(console.info).toHaveBeenCalledExactlyOnceWith(
      `[phone-width] passes now; the next record run drops it: ${passing.join('; ')}`,
    )
  })

  it('reports a passing check even if another listed check still fails', () => {
    const both: readonly PhoneWidthBaselineEntry[] = [
      { ...story, width: 320, checks: ['overflow', 'targets'] },
    ]
    expect(assertPhoneWidthBaseline(story, tooSmall, both)).toEqual([
      'forms-save--pending (Pending), 320 px, overflow',
    ])
    expect(console.info).toHaveBeenCalledWith(
      '[phone-width] passes now; the next record run drops it: forms-save--pending (Pending), 320 px, overflow',
    )
    vi.mocked(console.info).mockClear()
    expect(assertPhoneWidthBaseline(story, tooSmall, baseline)).toEqual([])
    expect(assertPhoneWidthBaseline(story, fits, [])).toEqual([])
    expect(console.info).not.toHaveBeenCalled()
  })

  it('fails on a new failure even when a recorded check passes in the same run', () => {
    const measurements = [
      {
        ...fits[0]!,
        overflow: ['a layer extends past the right edge: 488 px in 320 px'],
      },
      fits[1]!,
    ]
    expect(() => assertPhoneWidthBaseline(story, measurements, baseline)).toThrow(
      /488 px/,
    )
    expect(console.info).toHaveBeenCalledExactlyOnceWith(
      '[phone-width] passes now; the next record run drops it: forms-save--pending (Pending), 320 px, targets',
    )
  })

  it.each([
    ['a missing width', [fits[0]!]],
    ['a repeated width', [fits[0]!, fits[0]!]],
  ])('refuses incomplete measurements: %s', (_label, measurements) => {
    expect(() => assertPhoneWidthBaseline(story, measurements, [])).toThrow(
      /exactly once.*320.*390/s,
    )
  })

  it('rejects duplicate baseline entries rather than hiding stale checks', () => {
    expect(() =>
      assertPhoneWidthBaseline(story, tooSmall, [...baseline, ...baseline]),
    ).toThrow(/Duplicate.*forms-save--pending/s)
  })
})
