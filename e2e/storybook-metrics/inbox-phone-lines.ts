// The verdicts of the list-side phone grid: what a header, strip, chip row, row
// and filter sheet must measure. Pure except `readRowInternals`, which runs in
// the page, and the two `measure*` helpers, which call it. The tests that use
// them, and the grid they enforce, are in `inbox-phone.metrics.ts`.

import type { Page } from '@playwright/test'
import {
  GUTTER_PX,
  boxStartsOnGutter,
  controlsAre,
  found,
  heightIs,
  heightsAre,
  hitsAtLeast,
  inkEndsOnGutter,
  inkStartsAt,
  inkStartsOnGutter,
  inkStaysInsideGutter,
  insideWindow,
  measure,
  measureAll,
  spansWindow,
  type PageReport,
  type ScopeReport,
} from './phone-geometry'
import type { Finding } from './phone-story-tests'

const BAR_PX = 44
export const CONTROL_PX = 36
/** A queue pill in the strip. */
const PILL_PX = 32
const ROW_PX = 78
/** The checkbox column (20) and its gap (8) that the row text sits behind while selecting. */
const SELECTING_TEXT_X = GUTTER_PX + 20 + 8
/** The sheet caps at 85dvh. */
const SHEET_MAX_HEIGHT_RATIO = 0.85
/** An icon that shrank below this has been squeezed by its neighbours (the star is 14). */
const ROW_ICON_MIN_PX = 13.5
/** What the property may not shrink below beside a long guest name. */
const PROPERTY_MIN_PX = 24
/** The property, not the name, is what a row caps: at most this share of the identity line. */
const PROPERTY_CAP_RATIO = 0.4

export const HEADER = '[data-inbox-list-header]'
export const STRIP = 'nav[aria-label="Queues"]'
export const ROW = '[data-inbox-list-row]'
export const ACTIVE_FILTERS = '[role="group"][aria-label="Active filters"]'
const SHEET = '[data-slot="sheet-content"]'

export function headerLines(
  header: ScopeReport,
  view: PageReport,
): ReadonlyArray<string> {
  return [
    ...found(header, 'the list header'),
    ...heightIs('the list header', header.box, BAR_PX),
    ...spansWindow('the list header', header.box, view),
    ...controlsAre(header.controls, CONTROL_PX),
    ...hitsAtLeast(header.controls, CONTROL_PX),
    ...inkStartsOnGutter('the header content', header.ink),
    ...inkEndsOnGutter('the header content', header.ink, view),
  ]
}

export function stripLines(nav: ScopeReport, view: PageReport): ReadonlyArray<string> {
  return [
    ...found(nav, 'the queue strip'),
    ...heightIs('the queue strip', nav.box, BAR_PX),
    ...spansWindow('the queue strip', nav.box, view),
    ...controlsAre(nav.controls, PILL_PX),
  ]
}

export function activeFilterLines(
  group: ScopeReport,
  view: PageReport,
): ReadonlyArray<string> {
  const first = group.controls[0]
  return [
    ...found(group, 'the active-filters row'),
    ...heightIs('the active-filters row', group.box, BAR_PX),
    ...spansWindow('the active-filters row', group.box, view),
    // A removable chip is a control, so it takes the compact touch height (36px,
    // inside the row's 44px) like the Clear that ends the row.
    ...controlsAre(group.controls, CONTROL_PX),
    ...(first === undefined ? [] : boxStartsOnGutter('the first chip', first.box)),
  ]
}

/** What a row draws that the box test cannot see: icons squeezed, the property crowded out. */
type RowInternals = Readonly<{
  icon: number | null
  nameWidth: number | null
  /** The name's full text width, which is more than `nameWidth` once it truncates. */
  nameTextWidth: number | null
  propertyWidth: number | null
  identityWidth: number | null
  /** What the identity line needs with the name untruncated: its parts and gaps. */
  identityNeeds: number | null
  unreadDotCentre: number | null
  unreadDotRight: number | null
}>

function readRowInternals(rowSelector: string): ReadonlyArray<RowInternals> {
  return Array.from(document.querySelectorAll(rowSelector)).map((row) => {
    const open = row.querySelector('button[aria-label^="Open "]')
    const icon = open?.querySelector('svg') ?? null
    const identity = icon?.parentElement ?? null
    const parts = identity ? Array.from(identity.children) : []
    const property = parts.find((part) => (part.textContent ?? '').startsWith('·'))
    const name = property ? property.previousElementSibling : null
    const gap = identity
      ? Number.parseFloat(getComputedStyle(identity).columnGap) || 0
      : 0
    const identityNeeds =
      identity && name
        ? parts.reduce(
            (sum, part) =>
              sum +
              (part === name ? name.scrollWidth : part.getBoundingClientRect().width),
            gap * (parts.length - 1),
          )
        : null
    const dot =
      Array.from(row.querySelectorAll('.sr-only'))
        .find((el) => el.textContent === 'New since your last visit')
        ?.parentElement?.getBoundingClientRect() ?? null
    return {
      icon: icon ? icon.getBoundingClientRect().width : null,
      nameWidth: name ? name.getBoundingClientRect().width : null,
      nameTextWidth: name ? name.scrollWidth : null,
      propertyWidth: property ? property.getBoundingClientRect().width : null,
      identityWidth: identity ? identity.getBoundingClientRect().width : null,
      identityNeeds,
      unreadDotCentre: dot ? dot.left + dot.width / 2 : null,
      unreadDotRight: dot ? dot.right : null,
    }
  })
}

export function rowLines(
  rows: ReadonlyArray<ScopeReport>,
  internals: ReadonlyArray<RowInternals>,
  view: PageReport,
  options: Readonly<{ selecting: boolean; unread: boolean; properties: boolean }>,
): ReadonlyArray<string> {
  if (rows.length === 0) return ['no list row is on screen']
  return rows.flatMap((row, index) => {
    const what = `row ${index + 1}`
    const open = row.controls.find((control) => control.name.startsWith('Open '))
    const checkbox = row.controls.find((control) => control.role === 'checkbox')
    const inner = internals[index]
    const atRest = options.selecting
      ? [
          ...(checkbox === undefined
            ? [`${what} shows no checkbox while selecting`]
            : [
                ...boxStartsOnGutter(`${what}'s checkbox`, checkbox.box),
                ...hitsAtLeast([checkbox], CONTROL_PX),
              ]),
          ...(open === undefined
            ? [`${what} has no open button`]
            : inkStartsAt(`${what}'s text`, open.ink, SELECTING_TEXT_X)),
        ]
      : [
          ...inkStartsOnGutter(what, row.ink),
          ...(checkbox === undefined
            ? []
            : [
                `${what} shows its checkbox at rest, where a phone selects from the header`,
              ]),
        ]
    return [
      ...heightIs(what, row.box, ROW_PX),
      ...spansWindow(what, row.box, view),
      ...atRest,
      ...inkStaysInsideGutter(what, row.ink, view),
      ...(inner?.icon == null
        ? [`${what} has no leading icon to measure`]
        : inner.icon < ROW_ICON_MIN_PX
          ? [`${what}'s leading icon shrank to ${inner.icon} px`]
          : []),
      ...(options.properties && inner?.propertyWidth != null
        ? [
            ...(inner.propertyWidth < PROPERTY_MIN_PX
              ? [`${what}'s property is squeezed to ${inner.propertyWidth} px`]
              : []),
            ...(inner.identityWidth != null &&
            inner.propertyWidth > inner.identityWidth * PROPERTY_CAP_RATIO + 1
              ? [
                  `${what}'s property is ${inner.propertyWidth} px of a ${inner.identityWidth} px line, over the ${PROPERTY_CAP_RATIO * 100}% cap`,
                ]
              : []),
            // The name keeps priority: when name, icons and property fit the
            // line together the name may not truncate (a name capped at 65%
            // did, beside a short property).
            ...(inner.nameWidth != null &&
            inner.nameTextWidth != null &&
            inner.identityWidth != null &&
            inner.identityNeeds != null &&
            inner.identityNeeds <= inner.identityWidth &&
            inner.nameTextWidth > inner.nameWidth + 1
              ? [
                  `${what}'s name is cut to ${inner.nameWidth} of ${inner.nameTextWidth} px though the whole ${inner.identityWidth} px line needs only ${inner.identityNeeds}`,
                ]
              : []),
          ]
        : []),
      ...(options.unread
        ? inner?.unreadDotCentre == null
          ? [`${what} has no unread dot`]
          : [
              ...(Math.abs(inner.unreadDotCentre - GUTTER_PX / 2) > 1
                ? [
                    `${what}'s unread dot is centred at x=${inner.unreadDotCentre}, expected ${GUTTER_PX / 2} (the middle of the gutter)`,
                  ]
                : []),
              ...((inner.unreadDotRight ?? 0) > GUTTER_PX + 1
                ? [
                    `${what}'s unread dot reaches x=${inner.unreadDotRight}, into the text`,
                  ]
                : []),
            ]
        : []),
    ]
  })
}

export async function measureRows(
  page: Page,
  view: PageReport,
  options: Readonly<{ selecting: boolean; unread: boolean; properties: boolean }>,
): Promise<Finding> {
  const rows = await measureAll(page, ROW)
  const internals = await page.evaluate(readRowInternals, ROW)
  return {
    evidence: { rows, internals },
    lines: rowLines(rows, internals, view, options),
  }
}

type SheetParts = Readonly<{
  sheet: ScopeReport
  /** The scrolling body with the choice chips. */
  body: ScopeReport
  /** The action bar at the bottom: Clear filters and the results button. */
  footer: ScopeReport
  /** The title bar across the top. */
  bar: ScopeReport
  title: ScopeReport
}>

export function sheetLines(
  { sheet, body, footer, bar, title }: SheetParts,
  view: PageReport,
): ReadonlyArray<string> {
  const chips = sheet.controls.filter((control) => control.role === 'radio')
  const close = sheet.controls.find((control) => control.name === 'Close')
  const actions = footer.controls
  const firstAction = actions[0]
  const lastAction = actions[actions.length - 1]
  const leftmostChip = chips.reduce(
    (left, chip) => Math.min(left, chip.box.left),
    Number.POSITIVE_INFINITY,
  )
  return [
    ...found(sheet, 'the filter sheet'),
    ...insideWindow('the filter sheet', sheet.box, view),
    ...spansWindow('the filter sheet', sheet.box, view),
    ...(Math.abs(sheet.box.bottom - view.innerHeight) > 0.5
      ? [
          `the filter sheet ends at y=${sheet.box.bottom}, not on the window's bottom edge ${view.innerHeight}`,
        ]
      : []),
    ...(sheet.box.height > view.innerHeight * SHEET_MAX_HEIGHT_RATIO + 1
      ? [
          `the filter sheet is ${sheet.box.height} px tall, over ${SHEET_MAX_HEIGHT_RATIO * 100}% of the ${view.innerHeight} px window`,
        ]
      : []),
    ...(sheet.scrollWidth > sheet.clientWidth ||
    (body.found && body.scrollWidth > body.clientWidth)
      ? [
          `the filter sheet scrolls sideways: sheet ${sheet.scrollWidth}/${sheet.clientWidth}, body ${body.scrollWidth}/${body.clientWidth}`,
        ]
      : []),
    ...(chips.length === 0 ? ['the filter sheet shows no choice chips'] : []),
    ...heightsAre(chips, CONTROL_PX),
    // Horizontally only: the body scrolls, so a chip below the fold is not
    // outside the sheet, but none may cross a gutter.
    ...chips
      .filter(
        (chip) =>
          chip.box.left < GUTTER_PX - 1 ||
          chip.box.right > view.innerWidth - GUTTER_PX + 1,
      )
      .map(
        (chip) =>
          `chip "${chip.name}" is x=${chip.box.left}..${chip.box.right}, across a ${GUTTER_PX} px gutter of the ${view.innerWidth} px window`,
      ),
    ...(chips.length > 0 && Math.abs(leftmostChip - GUTTER_PX) > 1
      ? [`the chips start at x=${leftmostChip}, expected ${GUTTER_PX}`]
      : []),
    ...found(bar, 'the sheet title bar'),
    // A bar is 44 px on every phone surface; the 36 px Close fits inside it.
    ...heightIs('the sheet title bar', bar.box, BAR_PX),
    ...found(title, 'the sheet title'),
    ...inkStartsOnGutter('the sheet title', title.ink),
    ...(close === undefined
      ? ['the filter sheet has no Close button']
      : [
          ...heightsAre([close], CONTROL_PX),
          ...inkEndsOnGutter('the Close glyph', close.ink, view),
        ]),
    ...(actions.length < 2
      ? [
          `the sheet footer has ${actions.length} button(s), expected Clear filters and the results button`,
        ]
      : []),
    // The footer is the sheet's bottom action bar: its buttons are bar height.
    ...heightsAre(actions, BAR_PX),
    ...hitsAtLeast(actions, CONTROL_PX),
    ...actions.flatMap((action) =>
      insideWindow(`footer "${action.name}"`, action.box, view),
    ),
    ...(firstAction === undefined
      ? []
      : boxStartsOnGutter('the first footer button', firstAction.box)),
    ...(lastAction === undefined
      ? []
      : [
          ...(Math.abs(lastAction.box.right - (view.innerWidth - GUTTER_PX)) > 1
            ? [
                `the last footer button ends at x=${lastAction.box.right}, expected ${view.innerWidth - GUTTER_PX}`,
              ]
            : []),
        ]),
  ]
}

export async function measureSheet(page: Page, view: PageReport): Promise<Finding> {
  const sheet = await measure(page, SHEET)
  const body = await measure(page, `${SHEET} > div[class*="overflow-y-auto"]`)
  const footer = await measure(page, `${SHEET} > div[class*="border-t"]`)
  const bar = await measure(page, `${SHEET} > div[class*="border-b"]`)
  const title = await measure(page, `${SHEET} h2`)
  return {
    evidence: { sheet, body, footer, bar, title },
    lines: sheetLines({ sheet, body, footer, bar, title }, view),
  }
}
