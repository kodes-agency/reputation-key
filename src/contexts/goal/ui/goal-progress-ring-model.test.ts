// goal-progress-ring-model — branch-pinning tests (BQC-5.3 follow-up).
// Lives here (not colocated in src/components/goals/) because
// scripts/check-filenames.mjs bars *.test.* from src/components/**;
// goal view-derivation tests already live in this dir (helpers.test.ts).
// Visual states are covered by goal-progress-ring.stories.tsx; these pin the
// derived-value model for the key branches with a fixed render clock.

import { describe, it, expect } from 'vitest'
import {
  buildRingModel,
  type GoalProgressRingProps,
} from '#/components/goals/goal-progress-ring-model'

// 2026-07-16 is ~48% through the July period (07-01 → 07-31T23:59:59Z):
// elapsed fraction ≈ 0.484 → expected ≈ 48.4 for a target of 100.
const NOW = new Date('2026-07-16T00:00:00Z')
const JULY = {
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-07-31T23:59:59Z'),
} as const

function makeProps(
  overrides: Partial<GoalProgressRingProps> = {},
): GoalProgressRingProps & {
  now: Date
} {
  return {
    currentValue: 42,
    targetValue: 100,
    status: 'active',
    now: NOW,
    ...overrides,
  }
}

describe('buildRingModel', () => {
  it('complete via status: label 100%, green arc, no pace hint', () => {
    const m = buildRingModel(
      makeProps({ status: 'completed', currentValue: 100, ...JULY }),
    )
    expect(m.label).toBe('100%')
    expect(m.progressArcClass).toContain('stroke-green-500')
    expect(m.showPaceHintText).toBe(false)
  })

  it('complete via current >= target even when active', () => {
    const m = buildRingModel(makeProps({ currentValue: 100, ...JULY }))
    expect(m.label).toBe('100%')
    expect(m.progressArcClass).toContain('stroke-green-500')
  })

  it('ahead of pace: ↑ hint with floored expected pct', () => {
    const m = buildRingModel(makeProps({ currentValue: 85, ...JULY }))
    expect(m.paceArrow).toBe('↑')
    expect(m.showPaceHintText).toBe(true)
    expect(m.expectedPctFloor).toBe(48)
    expect(m.showNotch).toBe(true)
  })

  it('behind pace: ↓ hint', () => {
    const m = buildRingModel(makeProps({ currentValue: 12, ...JULY }))
    expect(m.paceArrow).toBe('↓')
    expect(m.showPaceHintText).toBe(true)
  })

  it('on-pace within tolerance: ≈ hint', () => {
    const m = buildRingModel(makeProps({ currentValue: 48, ...JULY }))
    expect(m.paceArrow).toBe('≈')
    expect(m.showPaceHintText).toBe(true)
  })

  it('no period: no notch, no hint, gray arc', () => {
    const m = buildRingModel(makeProps({ periodStart: null, periodEnd: null }))
    expect(m.showNotch).toBe(false)
    expect(m.showPaceHintText).toBe(false)
    expect(m.progressArcClass).toContain('stroke-gray-400')
  })

  it('expectedOverride drives the notch without period dates', () => {
    const m = buildRingModel(makeProps({ currentValue: 40, expectedValue: 30 }))
    expect(m.expectedPctFloor).toBe(30)
    expect(m.showNotch).toBe(true)
    expect(m.paceArrow).toBe('↑')
  })

  it('notch hidden beyond the 0.5/99.5 thresholds', () => {
    expect(buildRingModel(makeProps({ expectedValue: 0.4 })).showNotch).toBe(false)
    expect(buildRingModel(makeProps({ expectedValue: 99.6 })).showNotch).toBe(false)
  })

  it('showPaceHint=false suppresses the hint text', () => {
    const m = buildRingModel(
      makeProps({ currentValue: 85, ...JULY, showPaceHint: false }),
    )
    expect(m.showPaceHintText).toBe(false)
  })

  it('zero target: pace no-period leaves notchColor undefined (original quirk)', () => {
    const m = buildRingModel(
      makeProps({ currentValue: 0, targetValue: 0, expectedValue: 0 }),
    )
    expect(m.showPaceHintText).toBe(false)
    expect(m.notchDotClass).toBe('')
  })

  it('size variants select box/stroke/font', () => {
    expect(buildRingModel(makeProps({ size: 'sm' }))).toMatchObject({
      box: 64,
      stroke: 6,
      font: 'text-[10px]',
    })
    expect(buildRingModel(makeProps())).toMatchObject({
      box: 88,
      stroke: 8,
      font: 'text-xs',
    })
    expect(buildRingModel(makeProps({ size: 'lg' }))).toMatchObject({
      box: 112,
      stroke: 9,
      font: 'text-sm',
    })
  })

  it('ariaLabel override wins; default is the progress summary', () => {
    expect(buildRingModel(makeProps({ ariaLabel: 'Scan progress' })).effectiveAria).toBe(
      'Scan progress',
    )
    expect(buildRingModel(makeProps()).effectiveAria).toBe('Progress: 42% of 100')
  })

  it('aria values are rounded; label floors the percent', () => {
    const m = buildRingModel(makeProps({ currentValue: 42.6, targetValue: 100.4 }))
    expect(m.ariaValueNow).toBe(43)
    expect(m.ariaValueMax).toBe(100)
    expect(m.label).toBe('42%')
  })
})
