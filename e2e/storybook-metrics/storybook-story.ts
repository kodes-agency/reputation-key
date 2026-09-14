// Open one Storybook story in its bare iframe, wait until its `play` has
// finished — on signals Storybook itself sets, never on a timer — and refuse to
// hand back a story whose play threw.
//
// Line references are to `node_modules/storybook/dist/preview/runtime.js`,
// storybook 10.6.0, the bundle the iframe runs.
//
// ── "Finished" ──────────────────────────────────────────────────────────────
//
// The preview publishes its live render as `window.__STORYBOOK_PREVIEW__
// .currentRender`, a `StoryRender` (:35506) carrying the story `id` and a
// `phase`. The phases run `preparing → loading → beforeEach → rendering →
// playing → played → completing → completed → afterEach → finished`, and
// `finished` is the LAST one (:35681): it is set after the play resolves, after
// `completing` has awaited the story's CSS animations (:35669,
// `waitForAnimations` — which is what lets a Radix sheet finish sliding in
// before it is measured), and after the `afterEach` hooks. Nothing later moves
// the layout on Storybook's account.
//
// ── "Finished" is not "passed" ──────────────────────────────────────────────
//
// Measured while building this file: `Inbox/ReplyComposer` `EmptyAt390`
// loaded at 1440 goes `playing > errored > completing > completed > afterEach
// > finished`, with the body still `sb-show-main` and no error display. The
// testing preview annotations default `throwPlayFunctionExceptions` to `false`
// (:30862), so a throwing play is caught, announced on the channel as
// `playFunctionThrewException` (:35658), logged (:35661) — and the story then
// finishes like any other. A gate that waited on the phase alone would measure
// a half-played story and call it green.
//
// The channel is the only place that failure is said. Its global is assigned
// once, at runtime start (`syncGlobalSlot`, :12881), before any story loads,
// so an init script puts a setter on that global and subscribes the moment the
// channel exists — no polling, and no window in which an early exception could
// be emitted to nobody. A story that could not render at all (a bad id, a
// render that throws) shows the error display instead (`sb-show-errordisplay`,
// :37876); both end the wait, and both fail with Storybook's own words.
//
// No fixed timeout anywhere: a sleep is either too short on a cold dev server
// (flaky) or too long everywhere else (slow). PR 2's and PR 4's scratch
// harnesses carried a `waitForTimeout(250)` and `(300)` after this very phase
// check; this gate runs green without either, because `finished` already
// includes the animation wait those milliseconds were guessing at.

import type { Page } from '@playwright/test'

type StorybookWindow = Window & {
  __STORYBOOK_PREVIEW__?: { currentRender?: { id?: string; phase?: string } }
  __storyMetricsFailures?: string[]
  __storyMetricsSubscribed?: boolean
}

type Channel = Readonly<{
  on: (event: string, listener: (payload: unknown) => void) => void
}>

/**
 * Runs in the iframe before any of its scripts (`page.addInitScript`), so it
 * may reference nothing outside its own body.
 */
function recordStoryFailures(): void {
  const scope = window as StorybookWindow
  const failures: string[] = []
  scope.__storyMetricsFailures = failures
  const describe = (event: string, payload: unknown): string => {
    const errors = Array.isArray(payload) ? payload : [payload]
    const messages = errors.map((error) =>
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : JSON.stringify(error),
    )
    return `${event}: ${messages.join(' | ').replace(/\s+/g, ' ').slice(0, 600)}`
  }
  const FAILURE_EVENTS = [
    'playFunctionThrewException',
    'unhandledErrorsWhilePlaying',
    'storyThrewException',
    'storyErrored',
    'storyMissing',
  ]
  let installed: unknown
  const subscribed = new WeakSet<object>()
  Object.defineProperty(globalThis, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => installed,
    set: (next: unknown) => {
      installed = next
      if (typeof next !== 'object' || next === null || subscribed.has(next)) return
      subscribed.add(next)
      scope.__storyMetricsSubscribed = true
      for (const event of FAILURE_EVENTS) {
        ;(next as Channel).on(event, (payload) => failures.push(describe(event, payload)))
      }
    },
  })
}

export async function openStory(page: Page, storyId: string): Promise<void> {
  await page.addInitScript(recordStoryFailures)
  await page.goto(`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`)
  await page.waitForFunction((id) => {
    const render = (window as StorybookWindow).__STORYBOOK_PREVIEW__?.currentRender
    const body = document.body.classList
    return (
      (render?.id === id && render.phase === 'finished') ||
      body.contains('sb-show-errordisplay') ||
      body.contains('sb-show-nopreview')
    )
  }, storyId)
  const failures = await page.evaluate(() => {
    const scope = window as StorybookWindow
    const body = document.body.classList
    const text = (id: string): string =>
      (document.getElementById(id)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return [
      ...(scope.__storyMetricsFailures ?? []),
      ...(body.contains('sb-show-nopreview') ? ['Storybook rendered no preview'] : []),
      ...(body.contains('sb-show-errordisplay')
        ? [`error display: ${text('error-message')} ${text('error-stack').slice(0, 400)}`]
        : []),
      // The trap is only as good as Storybook's assignment reaching it. If a
      // later Storybook defined the global some other way, nothing would ever
      // subscribe and every throwing play would pass — so that is a failure.
      ...(scope.__storyMetricsSubscribed === true
        ? []
        : [
            'never subscribed to the Storybook channel, so a throwing play would go unseen',
          ]),
    ]
  })
  if (failures.length > 0) {
    const { width } = page.viewportSize() ?? { width: 0 }
    throw new Error(
      `${storyId} @ ${width}px did not play cleanly, so its geometry means nothing:\n` +
        failures.map((failure) => `  - ${failure}`).join('\n'),
    )
  }
  // Storybook's `padded` layout (the default) puts 1 rem of padding on the
  // body (`storybook/assets/server/base-preview-head.html:51-56`). That is
  // preview chrome, not product, and it is not neutral: a 390 px box in a
  // 390 px window becomes a 406 px document, which is how the first run failed
  // all 22 `Inbox/Thread` phone twins on "the document scrolls horizontally"
  // (`composer-dock.stories.tsx:182-185` measured the same 16 px and chose
  // `layout: 'fullscreen'`). Zeroing it measures every story the way the pane
  // actually sits in the page — flush — and can only remove Storybook's own
  // 32 px; a component wider than its box still overflows the document.
  await page.addStyleTag({
    content: '.sb-show-main.sb-main-padded { padding: 0 !important; }',
  })
  // Web fonts change text metrics, and a label that wraps once the face loads
  // changes a box. `document.fonts.ready` is the browser's own "done" signal.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}
