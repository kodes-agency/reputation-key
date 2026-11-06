import { afterEach, beforeEach, expect, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import type { StoryStart } from '../scripts/ci/storybook-story-starts'
import {
  measurePhoneWidths,
  provideViewportSetter,
} from '../src/shared/testing/phone-width'
import {
  assertPhoneWidthBaseline,
  type PhoneWidthBaselineEntry,
} from './phone-width-baseline'
import phoneWidthBaseline from './phone-width-failures.json'
import type { PhoneWidthObservation } from './phone-width-recorder'
import { stopUpdateLoop } from './stop-update-loop'

declare module 'vitest' {
  interface TaskMeta {
    /** Populated by @storybook/addon-vitest before the story renders. */
    storyId?: string
    phoneWidth?: PhoneWidthObservation
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Registered in vitest.config.ts; see scripts/ci/storybook-story-starts.ts. */
    storybookStoryStarts: (start: StoryStart) => Promise<void>
    /** Collects observations in Vitest's Node process across all story files. */
    recordPhoneWidthFailures: (observation: PhoneWidthObservation) => Promise<void>
  }
}

// `@storybook/react` reads `globalThis.FRAMEWORK_OPTIONS` once at module load
// to decide whether to mount stories under <StrictMode>. The Vite builder
// injects it by rewriting iframe.html, which this Vitest browser project never
// loads, so `framework.options.strictMode` in main.ts is silently ignored here.
// Define it before any story module is imported: the app mounts under
// StrictMode (src/client.tsx) and the component gate must too.
Object.assign(globalThis, { FRAMEWORK_OPTIONS: { strictMode: true } })

// Shared by explicit play-function checks and the global check after each story.
provideViewportSetter((width, height) => page.viewport(width, height))

// The stories load the app's compiled stylesheet (vitest.config.ts), so its enter and
// exit animations run. A play reads the page as soon as it has clicked, while Radix
// keeps a closing menu or dialog mounted, and the page behind it `aria-hidden`, until
// its animation ends, and a fading-in surface is at opacity 0 for its first frames.
// Animation is switched off here, in the runner only: Storybook proper still shows it.
// `prefers-reduced-motion` is not used for this, because the app's rule for it (0.01 ms)
// still ends each animation a frame later.
const noAnimation = document.createElement('style')
noAnimation.textContent = '*, *::before, *::after { animation: none !important; }'
document.head.append(noAnimation)

// Radix locks the body (`overflow: hidden`) while a modal is open. axe takes a label
// inside the fixed dialog for clipped when the body is only as tall as the story's
// own root, and reports the field it names as unlabelled (label-title-only). In the
// app the body holds the whole page; the runner gives it the same room.
const lockedBody = document.createElement('style')
lockedBody.textContent = 'body[data-scroll-locked] { min-height: 100vh; }'
document.head.append(lockedBody)

type ConsoleErrorAllowlistEntry = Readonly<{
  id: string
  pattern: RegExp | string
  owner: string
  reason: string
  /** ISO date (YYYY-MM-DD); the exception is valid through that day in UTC. */
  expires: string
}>

const CONSOLE_ERROR_ALLOWLIST: readonly ConsoleErrorAllowlistEntry[] = []
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const RESIZE_LOOP = 'ResizeObserver loop completed with undelivered notifications'

let recordedErrors: unknown[][] = []
let restoreConsoleError: (() => void) | undefined

function assertAllowlistEntry(entry: ConsoleErrorAllowlistEntry): void {
  if (!entry.id.trim() || !entry.owner.trim() || !entry.reason.trim()) {
    throw new Error(
      'Storybook console-error allowlist entries require id, owner and reason',
    )
  }
  if (!ISO_DATE.test(entry.expires)) {
    throw new Error(
      `Storybook console-error allowlist entry '${entry.id}' has invalid expiry`,
    )
  }
  const expiresAt = Date.parse(`${entry.expires}T23:59:59.999Z`)
  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    throw new Error(`Storybook console-error allowlist entry '${entry.id}' has expired`)
  }
}

function renderArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// The first hook of every story, so that what can freeze before it is as
// little as possible: tell the CI stall guard which story this page starts,
// and wait until it has heard. A page that then freezes is named exactly,
// which its batched updates cannot do (scripts/ci/storybook-story-starts.ts).
// With no guard listening, the answer comes straight back.
beforeEach(async ({ task }) => {
  await commands.storybookStoryStarts({ fileId: task.file.id, testId: task.id })
})

beforeEach(() => {
  const probe = document.createElement('div')
  probe.className = 'hidden'
  document.body.append(probe)
  try {
    expect(
      getComputedStyle(probe).display,
      'Stories must load compiled src/styles.css',
    ).toBe('none')
  } finally {
    probe.remove()
  }
})

beforeEach(() => {
  for (const entry of CONSOLE_ERROR_ALLOWLIST) assertAllowlistEntry(entry)
  recordedErrors = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    recordedErrors.push(args)
    // Recording is not enough for an effect that re-renders its component for
    // ever: the page never reaches afterEach. See stop-update-loop.ts.
    stopUpdateLoop(args)
  })
  restoreConsoleError = () => spy.mockRestore()
})

afterEach(async ({ task }) => {
  const errors: unknown[] = []
  try {
    const storyId = task.meta.storyId
    if (typeof storyId !== 'string' || !storyId) {
      throw new Error('Phone-width checks require the Storybook story id')
    }
    // The addon leaves the rendered state mounted until the next story starts.
    // Its test metadata supplies the stable id, including stories with no play.
    const story = { storyId, state: task.name }
    const heard = recordedErrors.length
    const measurements = await measurePhoneWidths()
    // Resizing the window is the check's own doing: observers it wakes can miss
    // the frame, which Chromium reports as an error that says nothing about the story.
    recordedErrors = [
      ...recordedErrors.slice(0, heard),
      ...recordedErrors
        .slice(heard)
        .filter((args) => !args.some((arg) => renderArgument(arg).includes(RESIZE_LOOP))),
    ]
    task.meta.phoneWidth = { ...story, measurements }
    if (import.meta.env.PHONE_WIDTH_RECORD === '1') {
      await commands.recordPhoneWidthFailures(task.meta.phoneWidth)
    } else {
      try {
        assertPhoneWidthBaseline(
          story,
          measurements,
          phoneWidthBaseline as readonly PhoneWidthBaselineEntry[],
        )
      } catch (error) {
        // The inventory is what CI's Linux Chromium measures. Text sets a few
        // pixels differently elsewhere, so another platform reports, not fails.
        if (import.meta.env.PHONE_WIDTH_PLATFORM === 'linux') throw error
        const findings = error instanceof Error ? error.message : String(error)
        console.info(`[phone-width] not failing off Linux:\n${findings}`)
      }
    }
  } catch (error) {
    errors.push(error)
  }

  const unexpected = recordedErrors
    .map((args) => args.map(renderArgument).join(' '))
    .filter((message) => {
      const allowlisted = CONSOLE_ERROR_ALLOWLIST.some(({ pattern }) => {
        if (typeof pattern === 'string') return message.includes(pattern)
        pattern.lastIndex = 0
        return pattern.test(message)
      })
      return !allowlisted
    })

  restoreConsoleError?.()
  restoreConsoleError = undefined

  if (unexpected.length > 0) {
    errors.push(
      new Error(
        `Unexpected console.error output:\n${unexpected
          .map((message, index) => `${index + 1}. ${message}`)
          .join('\n')}`,
      ),
    )
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, errors.map(renderArgument).join('\n'))
  }
})
