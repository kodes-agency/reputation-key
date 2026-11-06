import {
  PHONE_WIDTHS,
  type PhoneWidthMeasurement,
} from '../src/shared/testing/phone-width'

type StoryState = Readonly<{ storyId: string; state: string }>
type Check = 'overflow' | 'targets'

export type PhoneWidthBaselineEntry = StoryState &
  Readonly<{
    width: (typeof PHONE_WIDTHS)[number]
    checks: readonly Check[]
  }>

/**
 * Unlisted failures fail the story. Listed checks that pass are reported without
 * failing: layout can settle at different moments, so one pass is no proof of a repair.
 */
export function assertPhoneWidthBaseline(
  story: StoryState,
  measurements: readonly PhoneWidthMeasurement[],
  baseline: readonly PhoneWidthBaselineEntry[],
): readonly string[] {
  if (
    measurements.length !== PHONE_WIDTHS.length ||
    PHONE_WIDTHS.some(
      (width) =>
        measurements.filter((measurement) => measurement.width === width).length !== 1,
    )
  ) {
    throw new Error(
      `Measure exactly once at each phone width: ${PHONE_WIDTHS.join(', ')} px`,
    )
  }

  const recorded = baseline.filter(
    ({ storyId, state }) => storyId === story.storyId && state === story.state,
  )
  const problems: string[] = []
  const repaired: string[] = []
  for (const measurement of measurements) {
    const entries = recorded.filter(({ width }) => width === measurement.width)
    if (entries.length > 1) {
      throw new Error(
        `Duplicate phone-width baseline entry for ${story.storyId} (${story.state}), ${measurement.width} px`,
      )
    }
    const expected = entries[0]?.checks ?? []
    for (const check of ['overflow', 'targets'] as const) {
      const findings = measurement[check]
      const label = `${story.storyId} (${story.state}), ${measurement.width} px, ${check}`
      if (findings.length > 0 && !expected.includes(check)) {
        problems.push(`${label}:\n${findings.join('\n')}`)
      } else if (findings.length === 0 && expected.includes(check)) {
        repaired.push(label)
      }
    }
  }
  if (repaired.length > 0) {
    console.info(
      `[phone-width] passes now; the next record run drops it: ${repaired.join('; ')}`,
    )
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return repaired
}
