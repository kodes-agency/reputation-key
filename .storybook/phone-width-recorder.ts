import { readFile, writeFile } from 'node:fs/promises'
import { format } from 'prettier'
import type { PhoneWidthMeasurement } from '../src/shared/testing/phone-width'
import type { PhoneWidthBaselineEntry } from './phone-width-baseline'

export type PhoneWidthObservation = Readonly<{
  storyId: string
  state: string
  measurements: readonly PhoneWidthMeasurement[]
}>

/** One command instance in Vitest's Node process collects all browser story files. */
export function createPhoneWidthRecorder(outputFile: string) {
  const states = new Map<string, PhoneWidthBaselineEntry[]>()
  let baseline: readonly PhoneWidthBaselineEntry[] | undefined
  let pending = Promise.resolve()

  return (_context: unknown, observation: PhoneWidthObservation): Promise<void> => {
    const recording = pending.then(async () => {
      // Keep the original allowance across writes from separate story files.
      const existing = (baseline ??= JSON.parse(
        await readFile(outputFile, 'utf8'),
      ) as PhoneWidthBaselineEntry[])
      const { storyId, state, measurements } = observation
      const additions: string[] = []
      states.set(
        JSON.stringify([storyId, state]),
        measurements.flatMap(({ width, overflow, targets }) => {
          const entry = existing.find(
            (entry) =>
              entry.storyId === storyId && entry.state === state && entry.width === width,
          )
          const checks: ('overflow' | 'targets')[] = []
          for (const check of ['overflow', 'targets'] as const) {
            const findings = { overflow, targets }[check]
            if (findings.length === 0) continue
            if (entry?.checks.includes(check)) checks.push(check)
            else
              additions.push(
                `${storyId} (${state}), ${width} px, ${check}:\n${findings.join('\n')}`,
              )
          }
          return entry && checks.length > 0 ? [{ storyId, state, width, checks }] : []
        }),
      )
      const entries = [...states.values()].flat().sort((a, b) => {
        for (const key of ['storyId', 'state'] as const) {
          if (a[key] < b[key]) return -1
          if (a[key] > b[key]) return 1
        }
        return a.width - b.width
      })
      const json = await format(JSON.stringify(entries), { parser: 'json' })
      await writeFile(outputFile, json, 'utf8')
      if (additions.length > 0) {
        throw new Error(
          `New phone-width failures cannot be recorded:\n${additions.join('\n')}`,
        )
      }
    })
    // A failed story must not prevent observations from other files being saved.
    pending = recording.catch(() => {})
    return recording
  }
}
