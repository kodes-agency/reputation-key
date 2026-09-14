// Opens what the pane can open — every menu, popover, select and dialog
// trigger, then every closed disclosure — and measures the result, so a story
// whose play leaves everything closed still has its layers and its expanded
// states judged.
//
// ── Why the harness drives the pane instead of trusting the play ────────────
//
// A story is measured in its play's FINAL frame. Two things never reach that
// frame on their own:
//
//   - LAYERS are portalled to `document.body` and closed again by nearly every
//     play that opens one. Review found the first harness opened
//     `aria-haspopup="menu"` triggers only: a reply-due popover widened to
//     480 px (`inbox-case-toolbar.tsx`'s `w-80 max-w-[calc(100vw-2rem)]`
//     replaced) hung 160 px off a 320 px phone, and the run was green.
//   - A state the play ENTERS AND UNDOES is not the final frame. Review's
//     example: `inbox-thread--expanded-history-phone` opens the fold, then
//     refolds it from the keyboard (`inbox-thread.stories.tsx:1133-1139`), and
//     was measured folded — with `Hide 5 earlier events` shrunk to 28 px below
//     `md`, 68 runs passed. `expandDisclosures` opens every closed disclosure
//     in the pane after the final frame is judged, so the open state is
//     measured wherever a story can reach it.
//
// ── Why a failure here is a line, not a thrown error ────────────────────────
//
// An overflow regression can put one control over another, and Playwright's
// `click` then waits out its timeout ("<button …> intercepts pointer events").
// The first harness let that throw after 90 s, before the geometry it had
// already measured was printed: the run said "Test timeout of 90000ms
// exceeded" instead of "scrollWidth 452 > clientWidth 390". Here every action
// has its own short timeout, every failure becomes a `ProbeReport.error`
// naming the trigger and whatever intercepted it, and the caller has judged
// the pane before any of this runs (`inbox-detail.metrics.ts`).

import type { Locator, Page } from '@playwright/test'
import {
  countOpenLayers,
  measureLayers,
  waitForLayerCount,
  type MeasuredLayer,
} from './pane-metrics'

/**
 * A trigger names what it opens: Radix's `DropdownMenuTrigger` is
 * `aria-haspopup="menu"`; `PopoverTrigger`, `DialogTrigger` and
 * `AlertDialogTrigger` are `aria-haspopup="dialog"`; `SelectTrigger` is a
 * `role="combobox"` button. `true` is the ARIA 1.0 spelling of `menu`.
 */
const TRIGGER =
  ':is([aria-haspopup="menu"], [aria-haspopup="true"], [aria-haspopup="listbox"], [aria-haspopup="dialog"], [role="combobox"])'

/**
 * A disclosure: a button that says it is collapsed, or a closed `<details>`'s
 * `summary`. Popup triggers carry `aria-expanded="false"` too, and are
 * `TRIGGER`'s.
 */
const DISCLOSURE =
  ':is([aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"]), details:not([open]) > summary)'

const ENABLED = ':not([disabled]):not([aria-disabled="true"])'

/**
 * Marks what has been driven, so each is driven once. React leaves an
 * attribute it does not own alone; a trigger that re-mounts comes back
 * unmarked and is driven again, which `MAX_DRIVEN` bounds.
 */
const PROBED = 'data-metrics-probed'
const EXPANDED = 'data-metrics-expanded'

/**
 * Per action, far under the test's 90 s. A click that is going to land lands
 * in milliseconds on a warm story; five seconds is for a cold dev server's
 * first transform, not for waiting out an obstruction.
 */
const ACTION_TIMEOUT_MS = 5_000
/**
 * A cap on awaiting animations, not a wait: `settleAnimations` returns the
 * moment every finite animation has finished. One still running after this is
 * itself reported.
 */
const SETTLE_CAP_MS = 10_000
/** More triggers or disclosures than this in one state is a re-mounting loop. */
const MAX_DRIVEN = 40

export type ProbeReport = Readonly<{
  trigger: string
  layers: ReadonlyArray<MeasuredLayer>
  /** Why this trigger could not be judged, or `null` when it was. */
  error: string | null
}>

export type ExpansionReport = Readonly<{
  expanded: ReadonlyArray<string>
  errors: ReadonlyArray<string>
}>

/**
 * Wait for every finite CSS animation and transition in the document to END,
 * then two frames, so a Radix popper has placed its layer from the final box.
 * Resolves an error line when the cap passes first, `null` otherwise.
 *
 * Measured, not assumed: without this the first run failed 89 story/width
 * runs on 394 menu rows between 41.8 and 43.9 px — 44 px rows caught inside
 * the menu's `zoom-in-95` entry (`ui/dropdown-menu.tsx`,
 * `data-[state=open]:animate-in`); 41.8 is exactly 44 × 0.95, the entry's
 * first frame. A layer is visible from that first frame, so a visibility wait
 * returns while the transform is still scaling the box. INFINITE animations
 * (a spinner, a skeleton's pulse) never finish and move no box, and a paused
 * one never finishes either; both are left out. A cancelled animation rejects
 * its `finished` — its element left, which is also done.
 */
export async function settleAnimations(page: Page): Promise<string | null> {
  const finished = await page.evaluate(async (capMs) => {
    const running = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState !== 'paused' &&
          animation.effect?.getTiming().iterations !== Infinity,
      )
    const done = Promise.all(
      running.map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => true)
    const cap = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), capMs))
    const result = await Promise.race([done, cap])
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
    )
    return result
  }, SETTLE_CAP_MS)
  return finished ? null : `animations were still running after ${SETTLE_CAP_MS} ms`
}

/**
 * An action error's headline, and what intercepted the pointer when that was
 * why — without the terminal colour codes Playwright's call log carries, and
 * cut short: the interceptor is printed as its opening tag, which can run to
 * kilobytes of utility classes.
 */
function describeActionError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    // eslint-disable-next-line no-control-regex -- the ESC of an ANSI colour code
    /\u001b\[[0-9;]*m/g,
    '',
  )
  const lines = message.split('\n').map((line) => line.trim())
  const interceptor = lines
    .filter((line) => line.includes('intercepts pointer events'))
    .at(-1)
    ?.replace(/^-\s*/, '')
  const headline = lines[0] ?? message
  if (interceptor === undefined) return headline
  const short =
    interceptor.length > 240
      ? `${interceptor.slice(0, 200)}… intercepts pointer events`
      : interceptor
  return `${headline} — ${short}`
}

function nameOf(locator: Locator): Promise<string> {
  return locator.evaluate(
    (el) => {
      const label = el.getAttribute('aria-label')?.trim()
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      return label || text.slice(0, 80) || `<${el.tagName.toLowerCase()}>`
    },
    undefined,
    { timeout: ACTION_TIMEOUT_MS },
  )
}

/**
 * Close layers until `target` remain. Escape reaches only the top layer
 * (Radix's dismissable-layer stack), so the sheet behind a menu stays open —
 * and with nothing open Escape is never pressed, because on a sheet story it
 * would close the pane itself.
 */
async function closeLayersDownTo(
  page: Page,
  paneSelector: string,
  target: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await countOpenLayers(page, paneSelector)
    if (open <= target) return null
    await page.keyboard.press('Escape')
    await waitForLayerCount(page, paneSelector, { below: open }, ACTION_TIMEOUT_MS)
  }
  const left = await countOpenLayers(page, paneSelector)
  return left <= target ? null : `${left - target} layer(s) did not close on Escape`
}

/** Distinguishes one probing pass's marks from an earlier pass's on the same page. */
const passId = (): string => Math.random().toString(36).slice(2, 10)

/**
 * The first shown, enabled, not-yet-driven element matching `selector` in the
 * pane, marked as driven before it is touched — so a failure cannot make the
 * loop pick the same element again. The mark carries a per-pass sequence and
 * the returned locator addresses THAT: a locator still carrying
 * `:not([marker])` would stop matching the element the moment it is marked.
 */
async function nextUndriven(
  page: Page,
  paneSelector: string,
  selector: string,
  marker: string,
  sequence: string,
): Promise<Locator | null> {
  const next = page
    .locator(`${paneSelector} ${selector}${ENABLED}:not([${marker}])`)
    .filter({ visible: true })
    .first()
  if ((await next.count()) === 0) return null
  await next.evaluate(
    (el, mark) => el.setAttribute(mark.attribute, mark.value),
    { attribute: marker, value: sequence },
    { timeout: ACTION_TIMEOUT_MS },
  )
  return page.locator(`${paneSelector} [${marker}="${sequence}"]`).first()
}

/**
 * Open every popup trigger in the pane, one at a time, and measure what opens.
 * A layer a play left open was measured with the pane and is closed first:
 * Radix's modal layers set `pointer-events: none` on the body, so no other
 * trigger could be clicked. Stops at `deadline` (epoch ms) and says so, rather
 * than let the test's own timeout cut the evidence off.
 */
export async function probeLayers(
  page: Page,
  paneSelector: string,
  deadline: number,
): Promise<ReadonlyArray<ProbeReport>> {
  const pass = passId()
  const reports: ProbeReport[] = []
  const report = (trigger: string, error: string | null, layers: MeasuredLayer[] = []) =>
    reports.push({ trigger, layers, error })
  const unsettled = await settleAnimations(page)
  if (unsettled !== null) report('(before probing)', unsettled)
  const leftOpen = await closeLayersDownTo(page, paneSelector, 0)
  if (leftOpen !== null)
    return [...reports, { trigger: '(the play)', layers: [], error: leftOpen }]

  for (let driven = 0; driven <= MAX_DRIVEN; driven += 1) {
    if (Date.now() > deadline) {
      report('(time budget)', 'probing stopped before every trigger was opened')
      break
    }
    const trigger = await nextUndriven(
      page,
      paneSelector,
      TRIGGER,
      PROBED,
      `${pass}-${driven}`,
    )
    if (trigger === null) break
    if (driven === MAX_DRIVEN) {
      report('(re-mount loop)', `more than ${MAX_DRIVEN} triggers came and went`)
      break
    }
    const name = await nameOf(trigger)
    try {
      await trigger.click({ timeout: ACTION_TIMEOUT_MS })
    } catch (error: unknown) {
      report(name, `could not be clicked: ${describeActionError(error)}`)
      continue
    }
    const opened = await waitForLayerCount(
      page,
      paneSelector,
      { above: 0 },
      ACTION_TIMEOUT_MS,
    )
    if (!opened) {
      // A trigger that claims a popup and opens nothing is either broken or a
      // kind of trigger this harness does not know; neither may pass unseen.
      report(name, 'claims a popup, but clicking it opened no menu, listbox or dialog')
      continue
    }
    const unsettledLayer = await settleAnimations(page)
    report(name, unsettledLayer, [...(await measureLayers(page, paneSelector))])
    const stuck = await closeLayersDownTo(page, paneSelector, 0)
    if (stuck !== null) {
      report(name, `${stuck}; probing stopped`)
      break
    }
  }
  return reports
}

/**
 * Open every closed disclosure in the pane — a fold, a `<details>`, the
 * collapsed composer's bar — until none is left or `deadline` passes. A
 * disclosure whose NAME was already opened once is marked and skipped: the
 * collapsed composer can fold itself back when focus leaves it
 * (`reply-composer-collapsed.stories.tsx` `MobileCollapsesAgainIfNothingWasTouched`),
 * and re-opening its bar forever would only spend the budget.
 */
export async function expandDisclosures(
  page: Page,
  paneSelector: string,
  deadline: number,
): Promise<ExpansionReport> {
  const pass = passId()
  const expanded: string[] = []
  const errors: string[] = []
  for (let driven = 0; driven < MAX_DRIVEN && Date.now() <= deadline; driven += 1) {
    const disclosure = await nextUndriven(
      page,
      paneSelector,
      DISCLOSURE,
      EXPANDED,
      `${pass}-${driven}`,
    )
    if (disclosure === null) break
    const name = await nameOf(disclosure)
    if (expanded.includes(name)) continue
    try {
      await disclosure.click({ timeout: ACTION_TIMEOUT_MS })
      expanded.push(name)
    } catch (error: unknown) {
      errors.push(
        `disclosure "${name}" could not be opened: ${describeActionError(error)}`,
      )
    }
    const unsettled = await settleAnimations(page)
    if (unsettled !== null) errors.push(`after opening "${name}", ${unsettled}`)
  }
  return { expanded, errors }
}
