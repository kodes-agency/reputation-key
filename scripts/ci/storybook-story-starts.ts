// How the storybook stall guard names a frozen story exactly: at the start of
// every story, before it renders, the story's page tells the guard which story
// it is starting, and waits for the answer.
//
// The page's other updates cannot do that. Vitest sends them in batches, at
// most one per 100 ms, and a page that freezes never sends the batch it was
// filling, so on their own they leave two adjacent stories in doubt (see
// storybook-stall-guard.ts). This is a browser command instead: a direct call
// into Vitest's Node process, which the page awaits. A story that renders has
// therefore been heard to start, whatever happens to its page next.
//
// .storybook/vitest.setup.ts sends it from the first beforeEach of every story,
// and vitest.config.ts registers it for the storybook project. Only the
// storybook-test job adds the guard, so everywhere else, local runs and the
// Storybook UI's own test runs among them, nothing listens and the answer
// comes straight back.
//
// Command and guard meet on globalThis. Vitest 4.1 has no public list of its
// reporters to find the guard in, and module state cannot be shared either:
// the command is bundled into the loaded vitest.config.ts while Vitest's module
// runner loads the guard, so each has its own copy of this module. Both copies
// run in Vitest's one Node process, and a key from the global symbol registry
// is the same symbol in either copy and cannot collide with a real global. The
// guard listens only while its own run runs.

import type { BrowserCommand } from 'vitest/node'

/** What a story's page sends as it starts: the task ids its reporters see. */
export type StoryStart = Readonly<{
  /** The story file's task id, which reporters see as `TestModule.id`. */
  fileId: string
  /** The story's task id, which reporters see as `TestCase.id`. */
  testId: string
}>

export type StoryStartListener = (start: StoryStart) => void

const LISTENERS: unique symbol = Symbol.for('repkey.storybook-stall-guard.story-starts')

const registry = globalThis as typeof globalThis & {
  [LISTENERS]?: Set<StoryStartListener>
}

/** Calls `listener` with every story start until the function it returns is called. */
export function listenForStoryStarts(listener: StoryStartListener): () => void {
  const listeners = (registry[LISTENERS] ??= new Set())
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function isStoryStart(value: unknown): value is StoryStart {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fileId' in value &&
    typeof value.fileId === 'string' &&
    'testId' in value &&
    typeof value.testId === 'string'
  )
}

/** Tells every listening guard that a story started; with none listening, does nothing. */
export function announceStoryStart(start: unknown): void {
  if (!isStoryStart(start)) {
    throw new TypeError(
      'storybookStoryStarts takes the story task ids { fileId, testId }',
    )
  }
  for (const listener of registry[LISTENERS] ?? []) listener(start)
}

/** The browser command vitest.config.ts registers. The page's context is not needed. */
export const storybookStoryStarts: BrowserCommand<[start: StoryStart]> = (
  _context,
  start,
) => {
  announceStoryStart(start)
}
