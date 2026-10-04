// The inbox's phone grid, on the chrome side: the app top bar, the bell and the
// feedback launcher in it, and the review detail sheet that slides over the
// list (its header, case toolbar, conversation and composer). The list side is
// `inbox-phone.metrics.ts`; the grid it states, and how "on the gutter" is
// measured, are at the top of that file and of `phone-geometry.ts`.
//
// What is asserted, and what is deliberately not:
//
//   - the top bar is 44 px on an inbox page (`sidebarLocked`) and keeps its
//     52 px elsewhere, but its controls are 36 px on every phone page;
//   - the sidebar trigger's GLYPH and the account menu's avatar EDGE sit on the
//     16 px gutter;
//   - from `md` up nothing moved: 28 px trigger, 32 px bell and avatar button,
//     32 px feedback button, a 52 px bar;
//   - the detail sheet has no `border-l` below `sm` (it would shift everything
//     under it by a pixel), its header is 44 px with the back arrow's glyph on
//     the gutter, its case toolbar is 44 px (81 when its facts wrap), and the
//     three regions below it start their content there.
//
// The gate that every control in the sheet is >= 36 px and nothing overflows is
// still `inbox-detail.metrics.ts`; this file adds where things sit.

import type { Page } from '@playwright/test'
import {
  GUTTER_PX,
  boxEndsOnGutter,
  boxStartsAt,
  controlsAre,
  found,
  heightIs,
  heightsAre,
  inkStartsOnGutter,
  measure,
  spansWindow,
  type Box,
  type PageReport,
  type ScopeReport,
} from './phone-geometry'
import { DESKTOP, PHONES, storyTests, type Finding } from './phone-story-tests'

const BAR_PX = 44
const CONTROL_PX = 36
/** The app top bar where it is not an inbox page's, and at every width from `md`. */
const TOP_BAR_PX = 52
const DESKTOP_CONTROL_PX = 32
const DESKTOP_TRIGGER_PX = 28
const SHEET = '[data-slot="sheet-content"]'
/** The case toolbar with its facts on a second line: 2 + 36 + 4 + 36 + 2 + 1. */
const WRAPPED_TOOLBAR_PX = 81
/** The one detail-sheet story whose closed-review facts (`Replied on time`) wrap at 320. */
const WRAPS_AT_320 = 'inbox-mobile-390--review-closed'
/** Where `sm` starts: the sheet keeps its `border-l` from here. */
const SM_PX = 640

const named = (scope: ScopeReport, name: string | RegExp) =>
  scope.controls.find((control) =>
    typeof name === 'string' ? control.name === name : name.test(control.name),
  )

const sizeIs = (
  what: string,
  box: Box | undefined,
  width: number,
  height: number,
): ReadonlyArray<string> =>
  box === undefined
    ? [`${what} is not on screen`]
    : Math.abs(box.width - width) > 0.5 || Math.abs(box.height - height) > 0.5
      ? [`${what} is ${box.width}x${box.height}, expected ${width}x${height}`]
      : []

// ── The top bar ─────────────────────────────────────────────────────────────

async function checkTopBar(page: Page, view: PageReport, id: string): Promise<Finding> {
  const locked = id.endsWith('sidebar-locked')
  const phone = view.innerWidth < 768
  const header = await measure(page, '#storybook-root header')
  const trigger = named(header, 'Toggle Sidebar')
  const bell = named(header, /^Notifications/)
  const account = named(header, 'Account menu')
  const avatar = await measure(page, 'header button[aria-label="Account menu"] > *')
  const expectedBar = phone && locked ? BAR_PX : TOP_BAR_PX
  const phoneLines = [
    ...controlsAre(header.controls, CONTROL_PX),
    ...(trigger === undefined
      ? ['the sidebar trigger is not on screen on a phone']
      : inkStartsOnGutter('the sidebar trigger glyph', trigger.ink)),
    ...(account === undefined || !avatar.found
      ? ['the account menu is not on screen']
      : boxEndsOnGutter('the account avatar', avatar.box, view)),
  ]
  const desktopLines = [
    // Nothing moved from `md`: the sidebar trigger is 28 px (and gone on an inbox
    // page, where the desktop rail is always there), the rest 32.
    ...(locked
      ? trigger === undefined
        ? []
        : [
            'the sidebar trigger shows on a wide inbox page, where the rail is always there',
          ]
      : sizeIs(
          'the sidebar trigger',
          trigger?.box,
          DESKTOP_TRIGGER_PX,
          DESKTOP_TRIGGER_PX,
        )),
    ...sizeIs('the bell', bell?.box, DESKTOP_CONTROL_PX, DESKTOP_CONTROL_PX),
    ...sizeIs('the account button', account?.box, DESKTOP_CONTROL_PX, DESKTOP_CONTROL_PX),
  ]
  return {
    evidence: { header, avatar },
    lines: [
      ...found(header, 'the top bar'),
      ...heightIs('the top bar', header.box, expectedBar),
      ...spansWindow('the top bar', header.box, view),
      ...(phone ? phoneLines : desktopLines),
    ],
  }
}

storyTests('app top bar', ['layout-apptopbar--sidebar-locked'], PHONES, checkTopBar)
// The locked story's play finds the trigger, which a wide window hides, so it
// throws there: the desktop bar is measured through the unlocked story.
storyTests(
  'app top bar',
  ['layout-apptopbar--default'],
  [...PHONES, ...DESKTOP],
  checkTopBar,
)

// ── The bell and the feedback launcher ──────────────────────────────────────

storyTests(
  'notification bell',
  ['notification-notificationpanel--default'],
  [...PHONES, ...DESKTOP],
  async (page, view) => {
    const root = await measure(page, '#storybook-root')
    const bell = named(root, /^Notifications/)
    const size = view.innerWidth < 768 ? CONTROL_PX : DESKTOP_CONTROL_PX
    return { evidence: { root }, lines: sizeIs('the bell', bell?.box, size, size) }
  },
)

storyTests(
  'feedback launcher',
  ['beta-feedback-launcher--default'],
  [...PHONES, 700, ...DESKTOP],
  async (page, view) => {
    const root = await measure(page, '#storybook-root')
    const button = root.controls[0]
    // Below `sm` the label is hidden and the button is a 36 px square; from `sm`
    // to `md` it keeps 36 px height with its label; from `md` it is the desktop 32.
    const lines =
      button === undefined
        ? ['the feedback launcher is not on screen']
        : view.innerWidth < SM_PX
          ? sizeIs('the feedback launcher', button.box, CONTROL_PX, CONTROL_PX)
          : view.innerWidth < 768
            ? [
                ...heightsAre([button], CONTROL_PX),
                ...(button.box.width > CONTROL_PX
                  ? []
                  : [
                      `the feedback launcher lost its label: ${button.box.width} px wide`,
                    ]),
              ]
            : heightsAre([button], DESKTOP_CONTROL_PX)
    return { evidence: { root }, lines }
  },
)

// ── The detail sheet ────────────────────────────────────────────────────────

async function checkDetailSheet(
  page: Page,
  view: PageReport,
  id: string,
): Promise<Finding> {
  const sheet = await measure(page, SHEET)
  const header = await measure(page, `${SHEET} > header`)
  const toolbar = await measure(page, 'section[aria-label="Case status"]')
  const conversation = await measure(page, 'section[aria-label="Conversation"]')
  const composer = await measure(page, 'section[aria-label="Composer"]')
  const back = named(header, 'Back to list')
  const more = named(header, 'More actions for this review')
  const regions = [
    ['the case toolbar', toolbar],
    ['the conversation', conversation],
    ['the composer', composer],
  ] as const
  return {
    evidence: { sheet, header, toolbar, conversation, composer },
    lines: [
      ...found(sheet, 'the detail sheet'),
      ...spansWindow('the detail sheet', sheet.box, view),
      // A border-left would push the content it holds 1 px right of the list's.
      ...(sheet.borderLeftWidth > 0
        ? [`the detail sheet keeps a ${sheet.borderLeftWidth} px left border on a phone`]
        : []),
      ...heightIs(
        'the case toolbar',
        toolbar.box,
        id === WRAPS_AT_320 && view.innerWidth < 390 ? WRAPPED_TOOLBAR_PX : BAR_PX,
      ),
      ...found(header, 'the review header'),
      ...heightIs('the review header', header.box, BAR_PX),
      ...spansWindow('the review header', header.box, view),
      ...controlsAre(header.controls, CONTROL_PX),
      ...(back === undefined
        ? ['the review header has no Back to list button']
        : [
            ...sizeIs('Back to list', back.box, CONTROL_PX, CONTROL_PX),
            ...inkStartsOnGutter('the back arrow glyph', back.ink),
          ]),
      // The copy menu is an OUTLINE button: its box, not its glyph, is on the gutter.
      ...(more === undefined
        ? []
        : boxEndsOnGutter('More actions for this review', more.box, view)),
      ...regions.flatMap(([what, region]) => [
        ...found(region, what),
        ...(region.content === null
          ? [`${what} draws nothing narrower than the window`]
          : [
              ...boxStartsAt(what, region.content, GUTTER_PX),
              ...(region.content.right > view.innerWidth - GUTTER_PX + 1
                ? [
                    `${what} reaches x=${region.content.right}, past the ${view.innerWidth - GUTTER_PX} gutter`,
                  ]
                : []),
            ]),
      ]),
    ],
  }
}

storyTests(
  'detail sheet',
  [
    'inbox-detail-sheet--open',
    'inbox-detail-sheet--phone-gutters',
    'inbox-mobile-390--review-open',
    'inbox-mobile-390--review-closed',
    'inbox-mobile-390--mobile-composer-opens-collapsed',
  ],
  PHONES,
  checkDetailSheet,
)
