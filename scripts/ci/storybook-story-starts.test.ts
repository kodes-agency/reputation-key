// The channel between a story page's browser command and the stall guard. Its
// one property that matters most: a guard hears a story start through another
// copy of this module, as vitest.config.ts's bundled command and the guard
// loaded by Vitest's module runner are two copies in one process.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  announceStoryStart,
  listenForStoryStarts,
  type StoryStart,
} from './storybook-story-starts'

const START: StoryStart = { fileId: 'file-1', testId: 'file-1_0' }

describe('a story start', () => {
  let stopListening: (() => void)[] = []

  afterEach(() => {
    for (const stop of stopListening) stop()
    stopListening = []
  })

  function listen(): StoryStart[] {
    const heard: StoryStart[] = []
    stopListening = [...stopListening, listenForStoryStarts((start) => heard.push(start))]
    return heard
  }

  it('does nothing when no guard listens, as outside the storybook-test job', () => {
    expect(() => announceStoryStart(START)).not.toThrow()
  })

  it('reaches every listening guard', () => {
    const first = listen()
    const second = listen()

    announceStoryStart(START)

    expect([first, second]).toEqual([[START], [START]])
  })

  it('reaches a guard that listens through another copy of the module', async () => {
    const heard = listen()
    vi.resetModules()
    const copy = await import('./storybook-story-starts')

    copy.announceStoryStart(START)

    expect(copy.announceStoryStart).not.toBe(announceStoryStart)
    expect(heard).toEqual([START])
  })

  it('no longer reaches a guard that stopped listening', () => {
    const heard: StoryStart[] = []
    const stop = listenForStoryStarts((start) => heard.push(start))
    stop()

    announceStoryStart(START)

    expect(heard).toEqual([])
  })

  // Without this hook every story still passes, and the guard quietly goes
  // back to naming two candidates. A config without the command is loud
  // already: every story fails on the unknown command.
  it('is sent by the first beforeEach of every story', () => {
    const setup = readFileSync(
      resolve(import.meta.dirname, '../../.storybook/vitest.setup.ts'),
      'utf8',
    )
    const firstHook = setup.slice(setup.indexOf('beforeEach('))

    expect(firstHook.slice(0, firstHook.indexOf('\n})'))).toContain(
      'await commands.storybookStoryStarts({ fileId: task.file.id, testId: task.id })',
    )
  })

  it('must carry both task ids', () => {
    const heard = listen()

    for (const payload of [undefined, 'file-1_0', { fileId: 'file-1' }, { testId: 1 }]) {
      expect(() => announceStoryStart(payload)).toThrow(
        'storybookStoryStarts takes the story task ids { fileId, testId }',
      )
    }
    expect(heard).toEqual([])
  })
})
