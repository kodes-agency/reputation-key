// The inbox's phone grid, on the list side: the list header and its search and
// selection states, the queue strip, the rows, the active-filter chips and the
// filter sheet. Run with `pnpm test:storybook:metrics`, against Storybook with
// Tailwind compiled, at 320 and 390 (the phones `inbox-detail.metrics.ts`
// draws its panes at).
//
// The grid (the target every phone surface is built to):
//
//   1. a 16 px gutter: every bar, row and chip row starts its content at x=16
//      and ends it at window - 16;
//   2. bars are 44 px, the controls inside a bar 36 px (a removable chip is one,
//      and the compact density holds it to the touch height), queue pills 32 px,
//      the filter sheet's choice chips 36 px, list rows 78 px;
//   3. a ghost icon button at a bar's edge is pulled out so its GLYPH is on the
//      gutter; a box (outline button, pill, chip) puts its BOX there.
//
// Where this differs from `inbox-detail.metrics.ts`: that gate asks "is every
// target big enough and does nothing overflow"; it would stay green if a bar
// were 8 px off the gutter. This one asks where things sit. `phone-geometry.ts`
// says what "on the gutter" means and how it is measured.
//
// Two kinds of story are measured. The COMPONENT stories draw one part alone
// (`Inbox/List Header`, `Inbox/Queue Strip`, …); the PAGE stories
// (`pages-inbox--mobile-*`) draw them together, and are the only place the
// composition is checked: that the list panel is exactly the window wide (its
// `border-r` used to leave every bar 1 px short of the edge) and that the
// header's select-all checkbox and the rows' checkboxes share one x.
//
// What each surface must measure is `inbox-phone-lines.ts`; how a test is
// shaped (load, measure, run a check, attach the evidence) is
// `phone-story-tests.ts`, shared with `inbox-phone-chrome.metrics.ts`.
//
// A story only counts here if Tailwind is what lays it out: the ones that draw
// a part alone are `layout: 'fullscreen'` (a centered story shrink-wraps the
// part and pads it), and a story's own layout scaffold may not stand in for the
// classes (`inbox-queue-strip.stories.tsx` drops its scaffold when Tailwind is
// compiled).
//
// A red run prints one line per violation, with the measured number, and
// attaches every measurement as `phone-grid.json`.

import type { Page } from '@playwright/test'
import {
  GUTTER_PX,
  boxEndsOnGutter,
  boxStartsAt,
  boxStartsOnGutter,
  controlsAre,
  found,
  insideWindow,
  measure,
  measureAll,
} from './phone-geometry'
import {
  ACTIVE_FILTERS,
  CONTROL_PX,
  HEADER,
  ROW,
  STRIP,
  activeFilterLines,
  headerLines,
  measureRows,
  measureSheet,
  stripLines,
} from './inbox-phone-lines'
import { DESKTOP, PHONES, storyTests } from './phone-story-tests'

/** The strip's own padding from `md`, where the phone gutter no longer applies. */
const STRIP_PADDING_DESKTOP_PX = 12

// ── The list header ─────────────────────────────────────────────────────────
// Every state the phone header has: resting (with and without a property
// scope), filtered, searching and selecting.

storyTests(
  'list header',
  [
    'inbox-list-header--phone-resting',
    'inbox-list-header--phone-narrow',
    'inbox-list-header--phone-filtered',
    'inbox-list-header--phone-searching',
    'inbox-list-header--phone-selection',
    'inbox-list-header--phone-all-properties',
    'inbox-list-header--phone-all-properties-narrow',
  ],
  PHONES,
  async (page, view) => {
    const header = await measure(page, HEADER)
    return { evidence: { header }, lines: headerLines(header, view) }
  },
)

// ── The queue strip ─────────────────────────────────────────────────────────

/** A strip's fade is an inline mask, set only while something is out of reach. */
const maskOf = (page: Page, selector: string = STRIP): Promise<string> =>
  page.evaluate((target) => {
    const element = document.querySelector(target)
    return element ? getComputedStyle(element).maskImage : ''
  }, selector)

storyTests(
  'queue strip at rest',
  ['inbox-queue-strip--resting'],
  PHONES,
  async (page, view) => {
    const nav = await measure(page, STRIP)
    const mask = await maskOf(page)
    const first = nav.controls[0]
    return {
      evidence: { nav, mask },
      lines: [
        ...stripLines(nav, view),
        ...(first === undefined
          ? ['the strip has no pills']
          : boxStartsOnGutter('the first pill', first.box)),
        ...(nav.scrollLeft === 0
          ? []
          : [`the strip loaded scrolled by ${nav.scrollLeft} px`]),
        ...(mask === 'none'
          ? ['the strip has pills out of reach and draws no fade']
          : []),
      ],
    }
  },
)

storyTests(
  'queue strip on the last queue',
  ['inbox-queue-strip--closed-active'],
  PHONES,
  async (page, view) => {
    const nav = await measure(page, STRIP)
    const mask = await maskOf(page)
    const last = nav.controls[nav.controls.length - 1]
    return {
      evidence: { nav, mask },
      lines: [
        ...stripLines(nav, view),
        ...(last === undefined
          ? ['the strip has no pills']
          : [
              ...insideWindow('the active (last) pill', last.box, view),
              ...(last.box.right > view.innerWidth - GUTTER_PX + 1
                ? [
                    `the active pill ends at x=${last.box.right}, inside the window but on the gutter's far side (${view.innerWidth - GUTTER_PX})`,
                  ]
                : []),
            ]),
        ...(nav.scrollLeft > 0
          ? []
          : ['the strip did not scroll the active pill into view']),
        ...(mask === 'none'
          ? ['the strip has pills out of reach and draws no fade']
          : []),
      ],
    }
  },
)

// The active pill is scrolled in clear of the edge fade on both sides, not just
// of the edge, and snapping must not pull it back out (it did at 320 px):
// `STRIP_FADE_PX` in `ui/strip-scroll.ts`, restated here because the
// gate reads the rendered page and imports nothing from `src`.
const EDGE_FADE_PX = 24

storyTests(
  'queue strip on a middle queue',
  ['inbox-queue-strip--escalated-active', 'inbox-queue-strip--escalated-active-narrow'],
  PHONES,
  async (page, view) => {
    const nav = await measure(page, STRIP)
    const mask = await maskOf(page)
    const active = nav.controls.find((control) => control.name.startsWith('Escalated'))
    return {
      evidence: { nav, mask },
      lines: [
        ...stripLines(nav, view),
        ...(nav.scrollLeft > 0
          ? []
          : ['the strip did not scroll the active pill into view']),
        ...(active === undefined
          ? ['the strip has no Escalated pill']
          : [
              ...(active.box.left < EDGE_FADE_PX - 1
                ? [
                    `the active pill starts at x=${active.box.left}, under the ${EDGE_FADE_PX} px fade on the left edge`,
                  ]
                : []),
              ...(active.box.right > view.innerWidth - EDGE_FADE_PX + 1
                ? [
                    `the active pill ends at x=${active.box.right}, under the ${EDGE_FADE_PX} px fade that starts at x=${view.innerWidth - EDGE_FADE_PX} (a snap back to the previous pill leaves it half off the edge at 320 px)`,
                  ]
                : []),
            ]),
        ...(mask === 'none'
          ? ['the strip has pills out of reach and draws no fade']
          : []),
      ],
    }
  },
)

storyTests(
  'queue strip from md',
  // `resting` is a phone story: its play waits for the fade a wide window never draws.
  ['inbox-queue-strip--fits-without-fade'],
  DESKTOP,
  async (page, view) => {
    const nav = await measure(page, STRIP)
    const mask = await maskOf(page)
    const first = nav.controls[0]
    return {
      evidence: { nav, mask },
      lines: [
        ...stripLines(nav, view),
        ...(first === undefined
          ? ['the strip has no pills']
          : boxStartsAt('the first pill', first.box, STRIP_PADDING_DESKTOP_PX)),
        ...(mask === 'none'
          ? []
          : [`the strip draws a fade (${mask}) with nothing out of reach`]),
      ],
    }
  },
)

// ── Rows ────────────────────────────────────────────────────────────────────
// The phone stories are fullscreen, so a row spans the window as it does on the
// page. The stories that centre the list (`Default`, `WithSelection`, …) are not
// measured for position, only for their 78 px in `inbox-detail.metrics.ts`.

storyTests(
  'rows at rest',
  [
    'inbox-item-list--all-properties-phone',
    'inbox-item-list--single-property',
    'inbox-item-list--new-since-last-visit-phone',
  ],
  PHONES,
  (page, view, id) =>
    measureRows(page, view, {
      selecting: false,
      unread: id.includes('new-since'),
      properties: id.includes('all-properties'),
    }),
)

storyTests(
  'rows while selecting',
  ['inbox-item-list--selecting-phone'],
  PHONES,
  (page, view) =>
    measureRows(page, view, { selecting: true, unread: false, properties: false }),
)

// The skeleton stands in for the rows, so it starts where they will: text on
// the 16 px gutter (a row has no selection gutter at rest on a phone, and the
// skeleton's leading square used to put its bars at x=40), and the trailing
// bar on the far gutter.
storyTests('list while loading', ['pages-inbox--loading'], PHONES, async (page, view) => {
  // `:visible`: the first skeleton in the DOM is the leading square, which a
  // phone hides.
  await page.locator('[data-slot="skeleton"]:visible').first().waitFor()
  const bars = await measureAll(page, '[data-slot="skeleton"]')
  const first = bars[0]
  const last = bars[2]
  return {
    evidence: { bars: bars.slice(0, 3) },
    lines:
      first === undefined || last === undefined
        ? ['the loading list draws no skeleton rows']
        : [
            ...boxStartsOnGutter('the first skeleton bar', first.box),
            ...boxEndsOnGutter("the first row's trailing skeleton bar", last.box, view),
          ],
  }
})

// ── The search row ──────────────────────────────────────────────────────────
// Drawn in a 360 px frame with a 1 px border and `px-4`, so "the gutter" is
// the frame's inner edge plus 16.

storyTests('list search', ['inbox-list-search--phone'], [390], async (page) => {
  const frame = await measure(page, '#storybook-root > div')
  const expectedLeft = frame.box.left + frame.borderLeftWidth + GUTTER_PX
  const expectedRight = frame.box.right - frame.borderRightWidth - GUTTER_PX
  const close = frame.controls.find((control) => control.name === 'Close search')
  return {
    evidence: { frame },
    lines: [
      ...found(frame, 'the search frame'),
      ...controlsAre(frame.controls, CONTROL_PX),
      ...(frame.ink !== null && Math.abs(frame.ink.left - expectedLeft) > 1
        ? [`the search icon starts at x=${frame.ink.left}, expected ${expectedLeft}`]
        : []),
      ...(close?.ink != null && Math.abs(close.ink.right - expectedRight) > 1
        ? [`the Close glyph ends at x=${close.ink.right}, expected ${expectedRight}`]
        : []),
      ...(close === undefined ? ['the search row has no Close search button'] : []),
    ],
  }
})

// ── The active-filters row ──────────────────────────────────────────────────

// The row scrolls sideways when its chips do not fit, and says so the way the
// queue strip does: an edge fade while something is out of reach, none when
// every chip is in view.
storyTests(
  'active filters',
  ['inbox-active-filters--one-filter'],
  PHONES,
  async (page, view) => {
    const group = await measure(page, ACTIVE_FILTERS)
    const mask = await maskOf(page, ACTIVE_FILTERS)
    return {
      evidence: { group, mask },
      lines: [
        ...activeFilterLines(group, view),
        ...(group.scrollWidth > group.clientWidth ? ['one chip overflows the row'] : []),
        ...(mask === 'none'
          ? []
          : [`the row draws a fade (${mask}) with nothing out of reach`]),
      ],
    }
  },
)

storyTests(
  'active filters that overflow',
  ['inbox-active-filters--several-filters', 'inbox-active-filters--all-filters'],
  PHONES,
  async (page, view) => {
    const group = await measure(page, ACTIVE_FILTERS)
    const mask = await maskOf(page, ACTIVE_FILTERS)
    return {
      evidence: { group, mask },
      lines: [
        ...activeFilterLines(group, view),
        ...(group.scrollWidth > group.clientWidth
          ? []
          : [
              `the chips fit (${group.scrollWidth} px in ${group.clientWidth}): nothing to hint at`,
            ]),
        ...(mask === 'none' ? ['the row has chips out of reach and draws no fade'] : []),
      ],
    }
  },
)

// ── The filter sheet ────────────────────────────────────────────────────────
// Every story that ends with the sheet open, in its own state: default,
// choices made, and the three labels the results button takes.

storyTests(
  'filter sheet',
  [
    'inbox-filter-sheet--open',
    'inbox-filter-sheet--choose-source',
    'inbox-filter-sheet--clear-all',
    'inbox-filter-sheet--checked-chip-does-nothing',
    'inbox-filter-sheet--one-result',
    'inbox-filter-sheet--loading',
    'inbox-filter-sheet--no-results',
    'inbox-list-header--phone-filter-sheet',
  ],
  PHONES,
  (page, view) => measureSheet(page, view),
)

// ── The page ────────────────────────────────────────────────────────────────
// The composition: list panel, header, strip, chips and rows in one column, on
// the real page with real data, and the states a user gets into from it.

const PAGE_STORIES = [
  'pages-inbox--mobile-viewport',
  'pages-inbox--mobile-filtered-viewport',
] as const

/** The list panel is the header's parent: it must be exactly the window wide. */
const readPanel = (headerSelector: string) => {
  const panel = document.querySelector(headerSelector)?.parentElement
  if (!panel) return null
  const rect = panel.getBoundingClientRect()
  return {
    left: rect.left,
    width: rect.width,
    borderRight: Number.parseFloat(getComputedStyle(panel).borderRightWidth) || 0,
  }
}

async function waitForRows(page: Page): Promise<void> {
  await page.locator(ROW).first().waitFor()
}

storyTests('page at rest', PAGE_STORIES, PHONES, async (page, view, id) => {
  await waitForRows(page)
  const header = await measure(page, HEADER)
  const nav = await measure(page, STRIP)
  const filters = await measure(page, ACTIVE_FILTERS)
  const panel = await page.evaluate(readPanel, HEADER)
  const first = nav.controls[0]
  const rows = await measureRows(page, view, {
    selecting: false,
    unread: false,
    properties: false,
  })
  const filtered = id.includes('filtered')
  return {
    evidence: { header, nav, filters, panel, rows: rows.evidence },
    lines: [
      ...headerLines(header, view),
      ...stripLines(nav, view),
      ...(first === undefined ? [] : boxStartsOnGutter('the first pill', first.box)),
      ...(filtered
        ? activeFilterLines(filters, view)
        : filters.found
          ? ['the active-filters row shows with no filter applied']
          : []),
      ...(panel === null
        ? ['no list panel around the header']
        : [
            ...(Math.abs(panel.width - view.innerWidth) > 0.5 ||
            Math.abs(panel.left) > 0.5
              ? [
                  `the list panel is ${panel.width} px wide at x=${panel.left} in a ${view.innerWidth} px window`,
                ]
              : []),
            ...(panel.borderRight > 0
              ? [`the list panel keeps a ${panel.borderRight} px right border on a phone`]
              : []),
          ]),
      ...rows.lines,
    ],
  }
})

storyTests('page selecting', PAGE_STORIES, PHONES, async (page, view) => {
  await waitForRows(page)
  await page.getByRole('button', { name: 'Select items' }).click()
  await page
    .getByRole('checkbox', { name: /^Select item from/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Clear selection' }).waitFor()
  const header = await measure(page, HEADER)
  const rows = await measureAll(page, ROW)
  const selectAll = header.controls.find((control) => control.role === 'checkbox')
  const rowBoxes = rows.flatMap((row) =>
    row.controls.filter((control) => control.role === 'checkbox'),
  )
  return {
    evidence: { header, rows },
    lines: [
      ...headerLines(header, view),
      // The header's checkbox is a box, so its box is what sits on the gutter,
      // and the rows' checkboxes below it are on the same x.
      ...(selectAll === undefined
        ? ['the bulk bar has no select-all checkbox']
        : boxStartsOnGutter('the select-all checkbox', selectAll.box)),
      ...(rowBoxes.length === 0 ? ['no row shows a checkbox while selecting'] : []),
      ...rowBoxes.flatMap((checkbox, index) => [
        ...boxStartsOnGutter(`row ${index + 1}'s checkbox`, checkbox.box),
        ...(selectAll !== undefined &&
        Math.abs(checkbox.box.left - selectAll.box.left) > 0.5
          ? [
              `row ${index + 1}'s checkbox is at x=${checkbox.box.left}, the select-all at x=${selectAll.box.left}`,
            ]
          : []),
      ]),
    ],
  }
})

storyTests('page searching', PAGE_STORIES, PHONES, async (page, view) => {
  await waitForRows(page)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('searchbox', { name: 'Search reviews' }).waitFor()
  const header = await measure(page, HEADER)
  return { evidence: { header }, lines: headerLines(header, view) }
})

storyTests('page filter sheet', PAGE_STORIES, PHONES, async (page, view) => {
  await waitForRows(page)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('dialog', { name: 'Sort and filter' }).waitFor()
  // The sheet slides in; measure it where it stops.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished)).then(
      () => undefined,
    ),
  )
  return measureSheet(page, view)
})
