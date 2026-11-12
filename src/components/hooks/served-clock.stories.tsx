// A page the server printed and the browser hydrates a moment later, with the
// browser's clock past a minute, an hour and a day boundary of the server's: the
// first browser render must print the server's words (no hydration error), and a
// page mounted after that reads the browser's own clock.
import type { ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import type { Meta, StoryObj } from '@storybook/react'
import { expect } from 'storybook/test'
import { SERVED_AT_ATTRIBUTE } from './served-clock'
import { EditedAt, ReplyDue, ServedPage, ShareGraceCutoff } from './served-clock-fixtures'

const meta = {
  title: 'Hooks/Served clock',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const RealDate = Date

/** `Date` reads `ms` until the returned restore runs. */
function freezeClock(ms: number): () => void {
  class FrozenDate extends RealDate {
    constructor(value?: number | string) {
      super(value === undefined ? ms : value)
    }
    static override now() {
      return ms
    }
  }
  globalThis.Date = FrozenDate as DateConstructor
  return () => {
    globalThis.Date = RealDate
  }
}

type Rendered = Readonly<{ html: string; texts: ReadonlyArray<string> }>

const textsOf = (html: string): ReadonlyArray<string> =>
  Array.from(
    new DOMParser().parseFromString(html, 'text/html').querySelectorAll('p'),
  ).map((p) => p.textContent ?? '')

function serverRender(at: number, page: ReactElement): Rendered {
  document.documentElement.removeAttribute(SERVED_AT_ATTRIBUTE)
  const restore = freezeClock(at)
  try {
    const html = renderToString(page)
    return { html, texts: textsOf(html) }
  } finally {
    restore()
  }
}

async function hydrateAt(
  at: number,
  server: Rendered,
  page: ReactElement,
): Promise<{
  errors: ReadonlyArray<unknown>
  texts: ReadonlyArray<string>
  unmount: () => void
}> {
  const host = document.createElement('div')
  host.innerHTML = server.html
  document.body.append(host)
  // The browser takes the stamp from the `<html>` element it parsed.
  const stamp = host.querySelector('#served-stamp')?.getAttribute(SERVED_AT_ATTRIBUTE)
  document.documentElement.setAttribute(SERVED_AT_ATTRIBUTE, stamp ?? '')
  const errors: Array<unknown> = []
  const restore = freezeClock(at)
  const root = hydrateRoot(host, page, { onRecoverableError: (e) => errors.push(e) })
  await new Promise((r) => setTimeout(r, 50))
  const texts = Array.from(host.querySelectorAll('p')).map((p) => p.textContent ?? '')
  return {
    errors,
    texts,
    unmount: () => {
      restore()
      root.unmount()
      host.remove()
      document.documentElement.removeAttribute(SERVED_AT_ATTRIBUTE)
    },
  }
}

const SERVER_AT = RealDate.parse('2026-11-12T07:59:59.900Z')
const BROWSER_AT = SERVER_AT + 400
const iso = (offsetMs: number) => new RealDate(SERVER_AT + offsetMs).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const page = (
  <ServedPage>
    {/* Edited 60 s ago: "just now" becomes "1 min ago" a moment later. */}
    <EditedAt at={iso(-MIN + 100)} />
    {/* 07:59:59.9 and 08:00:00.3 UTC fall either side of midnight in Los Angeles. */}
    <EditedAt at={iso(-HOUR)} />
    {/* A cutoff 2 days and 200 ms out: "in 3 days" becomes "in 2 days". */}
    <ShareGraceCutoff graceExpiresAt={iso(2 * DAY + 200)} />
    {/* Due in 60 min 100 ms: the countdown's minute rolls over. */}
    <ReplyDue dueAt={iso(HOUR + 100)} />
  </ServedPage>
)

export const HydratesWithoutAMismatch: Story = {
  render: () => <p>Time-relative text hydrates from the instant the server rendered.</p>,
  play: async () => {
    const server = serverRender(SERVER_AT, page)
    expect(server.texts.length).toBe(4)

    const hydrated = await hydrateAt(BROWSER_AT, server, page)
    try {
      expect(hydrated.errors).toEqual([])
      expect(hydrated.texts).toEqual(server.texts)

      // Mounted after hydration (a client-side navigation): the browser's clock.
      const late = document.createElement('div')
      document.body.append(late)
      const restore = freezeClock(BROWSER_AT + 2 * DAY)
      const lateRoot = createRoot(late)
      lateRoot.render(page)
      await new Promise((r) => setTimeout(r, 50))
      const lateTexts = Array.from(late.querySelectorAll('p')).map(
        (p) => p.textContent ?? '',
      )
      restore()
      lateRoot.unmount()
      late.remove()
      expect(lateTexts).not.toEqual(server.texts)
    } finally {
      hydrated.unmount()
    }
  },
}
