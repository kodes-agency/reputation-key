import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPhoneWidthRecorder } from './phone-width-recorder'
import type { PhoneWidthBaselineEntry } from './phone-width-baseline'

const temporaryDirectories: string[] = []

async function inventory(entries: readonly PhoneWidthBaselineEntry[] = existing) {
  const directory = await mkdtemp(join(tmpdir(), 'phone-width-'))
  temporaryDirectories.push(directory)
  const file = join(directory, 'phone-width-failures.json')
  await writeFile(file, JSON.stringify(entries))
  return { file, record: createPhoneWidthRecorder(file) }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const first = {
  storyId: 'patterns-button--sizes',
  state: 'Sizes',
  measurements: [
    { width: 390 as const, overflow: [], targets: ['Small target'] },
    { width: 320 as const, overflow: ['Overflow'], targets: ['Small target'] },
  ],
}
const second = {
  storyId: 'layout-apptopbar--default',
  state: 'Default',
  measurements: [
    { width: 320 as const, overflow: [], targets: ['Small target'] },
    { width: 390 as const, overflow: [], targets: [] },
  ],
}

const existing: readonly PhoneWidthBaselineEntry[] = [
  {
    storyId: first.storyId,
    state: first.state,
    width: 320,
    checks: ['overflow', 'targets'],
  },
  { storyId: first.storyId, state: first.state, width: 390, checks: ['targets'] },
  { storyId: second.storyId, state: second.state, width: 320, checks: ['targets'] },
]

describe('phone-width inventory browser command', () => {
  it('merges simultaneous calls from separate story files and produces stable JSON', async () => {
    const { file, record } = await inventory()
    await Promise.all([
      record(undefined, first),
      record(undefined, second),
      record(undefined, first),
    ])
    const contents = await readFile(file, 'utf8')
    expect(JSON.parse(contents)).toEqual([
      { storyId: second.storyId, state: second.state, width: 320, checks: ['targets'] },
      {
        storyId: first.storyId,
        state: first.state,
        width: 320,
        checks: ['overflow', 'targets'],
      },
      { storyId: first.storyId, state: first.state, width: 390, checks: ['targets'] },
    ])

    const nextRun = createPhoneWidthRecorder(file)
    await nextRun(undefined, second)
    await nextRun(undefined, first)
    expect(await readFile(file, 'utf8')).toBe(contents)
  })

  it('rebuilds from current observations instead of retaining stale entries from disk', async () => {
    const { file, record } = await inventory()
    await writeFile(
      file,
      JSON.stringify([
        ...existing,
        { storyId: 'removed-story', state: 'Removed', width: 320, checks: ['overflow'] },
      ]),
    )
    await record(undefined, first)
    const entries = JSON.parse(await readFile(file, 'utf8'))
    expect(entries).toHaveLength(2)
    expect(
      entries.every((entry: { storyId: string }) => entry.storyId === first.storyId),
    ).toBe(true)
  })

  it('writes an empty list when all measured checks pass', async () => {
    const { file, record } = await inventory()
    await writeFile(file, JSON.stringify(existing))
    await record(undefined, {
      ...first,
      measurements: first.measurements.map(({ width }) => ({
        width,
        overflow: [],
        targets: [],
      })),
    })
    expect(await readFile(file, 'utf8')).toBe('[]\n')
  })

  it('keeps distinct states for the same story id', async () => {
    const { file, record } = await inventory([
      ...existing,
      { ...existing[2]!, state: 'Alternate' },
    ])
    await record(undefined, second)
    await record(undefined, { ...second, state: 'Alternate' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([
      { storyId: second.storyId, state: 'Alternate', width: 320, checks: ['targets'] },
      { storyId: second.storyId, state: 'Default', width: 320, checks: ['targets'] },
    ])
  })

  it('removes repaired checks while retaining listed failures', async () => {
    const { file, record } = await inventory()
    await record(undefined, {
      ...first,
      measurements: first.measurements.map((measurement) => ({
        ...measurement,
        overflow: [],
      })),
    })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([
      { ...existing[0]!, checks: ['targets'] },
      existing[1]!,
    ])
  })

  it.each([
    ['story', { ...second, storyId: 'new-story' }, /new-story.*320 px.*targets/s],
    ['state', { ...second, state: 'New state' }, /New state.*320 px.*targets/s],
    [
      'width',
      {
        ...second,
        measurements: [
          second.measurements[0]!,
          { ...second.measurements[0]!, width: 390 as const },
        ],
      },
      /390 px.*targets/s,
    ],
    [
      'check',
      {
        ...second,
        measurements: [
          { ...second.measurements[0]!, overflow: ['New overflow'] },
          second.measurements[1]!,
        ],
      },
      /320 px.*overflow.*New overflow/s,
    ],
  ])(
    'rejects an addition by %s while writing only the intersection',
    async (_label, observation, message) => {
      const { file, record } = await inventory()
      await expect(record(undefined, observation)).rejects.toThrow(message)
      const entries = JSON.parse(await readFile(file, 'utf8'))
      const retained =
        observation.storyId === second.storyId && observation.state === second.state
      expect(entries).toEqual(retained ? [existing[2]!] : [])
      // Another story file must still be recorded after a rejected addition.
      await record(undefined, first)
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([
        ...(retained ? [existing[2]!] : []),
        existing[0]!,
        existing[1]!,
      ])
    },
  )

  it('propagates write errors rather than reporting a successful inventory', async () => {
    const { file, record } = await inventory()
    await record(undefined, first)
    await rm(file)
    await rm(join(file, '..'), { recursive: true })
    await expect(record(undefined, first)).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'open',
    })
  })
})
