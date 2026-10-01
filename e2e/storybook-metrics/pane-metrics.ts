// Real-browser geometry for a Storybook story: touch targets, horizontal
// overflow and clipping, open layers, and the composer's primary, measured
// against compiled Tailwind.
//
// ── Why this exists, and why it is not a Storybook test ─────────────────────
//
// The Storybook Vitest project compiles NO Tailwind (`inbox-mobile-390.stories
// .tsx:32-41` probed it: `h-4` computes to 0px, `overflow-x-auto` to
// `visible`). A story there cannot fail on a 28 px button, a clipped footer or
// a row that overflows, so every width claim plan v2.1 makes was measured by
// hand in a throwaway script, once per PR — and every one of those scripts
// found a defect the Storybook gate could not see:
//
//   PR 2  the case toolbar scrolled behind a hidden scrollbar and overflowed on
//         10 of 62 phone runs (`docs/plan/inbox-detail-v2.md` row 20);
//   PR 3  connectors stopped 4 px short of every 24 px disc, and a 300-
//         character word overflowed the thread by 1,508 px (row 9);
//   PR 4  at 320x568 `Add note` sat at bottom 621.5 and `Review update` at
//         625.2, below the viewport behind the region's scroll backstop
//         (row 14).
//
// v1 had the same gap: row 15's 44 px rule was measured by hand and never
// gated, and its phone commit says what that cost — "Three separate passes
// found controls under the 44 px floor that source review and the Storybook
// gate both missed" (`git show -s 2a83876c`). This module is the measurement,
// committed, so the next change that shrinks a target or widens a row goes red
// instead of shipping.
//
// ── The rules, and where each number comes from ─────────────────────────────
//
// Below 768 px (Tailwind's `md`, and `useIsMobile`'s `MOBILE_BREAKPOINT`,
// `src/components/hooks/use-mobile.ts:3`) a control's smaller side is >= 36 px
// (row 20: "controls are 36 px, not 44"); a menu row and the collapsed pill are
// >= 44 px (row 20: "menu items 44", "Collapsed pill 44 px (unchanged)"). At
// 768 and up everything is >= 24 px — WCAG 2.5.8 AA. Desktop density is
// deliberate: the pane's toolbar members are 32 px outlined buttons (row 2),
// and a 36 px floor there would re-inflate the strip row 20 deflated.
//
// Geometry has four ways to put content where a finger cannot reach it, and
// each needs its own probe, because each hides from the others (a fifth, for
// text that runs out of its own box, is opt-in: `PaneOptions.textMustFitItsBox`):
//
//   1. the pane scrolls sideways — its own `scrollWidth`;
//   2. a SCROLLER inside it absorbs the overflow (PR 2's hidden scrollbar), so
//      the pane's `scrollWidth` stays equal to its `clientWidth` — every
//      `overflow-x: auto | scroll` descendant's `scrollWidth`;
//   3. a CLIPPER inside it cuts the overflow off (`overflow: hidden | clip`),
//      which raises nobody's `scrollWidth` above the clipper — so each shown
//      element is compared with the box of the ancestor that clips it
//      (`clippedIn`, below). Found by review: with the case toolbar made
//      `flex-nowrap overflow-hidden` and the reply-due detail 400 px wide, the
//      detail sat at 33..433 in a 320 px window while `Inbox/Mobile 390`
//      stayed green at 320 and 390;
//   4. a portalled LAYER (menu, listbox, popover, dialog) is `position: fixed`
//      and outside the pane, so neither the pane nor the document can see it
//      hang off the window — each layer's box and rows are compared with the
//      viewport itself (`layerIn`). Found by review: a `min-w-[480px]` owner
//      menu ran x=5..475 at 320 and a `w-[480px]` reply-due popover 0..480,
//      with the document's `scrollWidth` still 320.

import { errors, type Page } from '@playwright/test'

/** Tailwind's `md`, and `useIsMobile`'s breakpoint. Below it, `max-md:` applies. */
export const PHONE_BELOW_PX = 768
/** Plan row 20: a control below `md`. */
export const PHONE_CONTROL_MIN_PX = 36
/** Plan row 20: a menu row, and the collapsed composer's pill, below `md`. */
export const PHONE_THUMB_MIN_PX = 44
/** WCAG 2.5.8 AA, at `md` and up. */
export const DESKTOP_TARGET_MIN_PX = 24

/**
 * Sub-pixel slack for POSITIONS only — "inside the viewport", "inside the
 * clipping box". A box laid out at a fractional offset can report `bottom`
 * 0.2 px past an integer edge it visibly fits in. Target SIZES get no slack:
 * Tailwind sizes are whole pixels, and a 35.5 px control is exactly the
 * regression this gate is for.
 */
const POSITION_SLACK_PX = 0.5

/**
 * What is looked at. `summary` and `[tabindex="0"]` catch the disclosures and
 * custom controls a `button` query would miss; the three menu roles are
 * Radix's `DropdownMenuItem`, `…RadioItem` and `…CheckboxItem`, and `option`
 * is a `SelectItem` (Radix renders it as a `div` with no tabindex, so without
 * the role nothing here would find a select row). Not everything matched is a
 * target: a focusable element with no widget role (a tab panel, a
 * keyboard-scrollable paragraph) is a focus stop, and `isTarget` in
 * `measureInPage` leaves it out.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  '[role="button"]',
  'a[href]',
  'summary',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  'input',
  'textarea',
  'select',
  '[tabindex="0"]',
].join(', ')

/**
 * The ARIA widget roles a non-native element must carry to count as a target
 * (see `isTarget` in `measureInPage`). Every role the pane's primitives use for
 * something a finger presses, and the rest of the family for whatever a later
 * primitive adds.
 */
const WIDGET_ROLES = [
  'button',
  'link',
  'tab',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'checkbox',
  'radio',
  'switch',
  'option',
  'combobox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
  'gridcell',
]

/**
 * A portalled layer: Radix's `DropdownMenuContent` (`menu`), `SelectContent`
 * (`listbox`), `PopoverContent` and `DialogContent` (`dialog`), and
 * `AlertDialogContent` (`alertdialog`). The mobile sheet is a `dialog` too; a
 * layer that IS the pane, holds it, or sits inside it is the pane's, not a
 * layer (`measureInPage` drops it), which is how the sheet stories measure the
 * sheet once.
 */
export const LAYER_SELECTOR =
  '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]'

/**
 * Rows of a stacked list. Inside one, a row is a `menu-row` (44 px below
 * `md`); anywhere else in a layer — a popover's link, a dialog's `Cancel` — it
 * is a control (36 px). Row 20's PR 5 amendment: "MENU ITEMS, dropdown and
 * select rows alike, keep `max-md:min-h-11`: they stack edge to edge".
 */
const ROW_LIST_SELECTOR = '[role="menu"], [role="listbox"]'

/**
 * The collapsed composer's bar (`composer-mode-row.tsx` `MODE_PLACEHOLDER`).
 * Matched by its words rather than a class: both strings are pinned by e2e
 * (`inbox-triage.spec.ts`), so they are the steadiest handle the bar has.
 */
export const COLLAPSED_PILL_NAMES = ['Reply…', 'Add a note…'] as const

/**
 * Region 4's one primary per surface. `Submit for approval` (the reply, pinned
 * by `reply-lifecycle.spec.ts:185`; row 20's PR 4 amendment keeps the full
 * name on the phone), `Submit`, and `Add note` (pinned by
 * `inbox-triage.spec.ts:183`) are the brief's three. The other three are the
 * region's primaries the plan names too, and the ones a real browser already
 * caught below the fold once: `Review update` is the live editor's (row 14's
 * PR 4 amendment measured it at bottom 625.2 of a 568 px viewport), and
 * `Mark as handled` / `Correct outcome` are a feedback item's
 * (`feedback-handling-body.tsx:138,142`, row 10), which a note-only composer
 * keeps even while collapsed.
 */
export const COMPOSER_PRIMARY_NAMES = [
  'Submit for approval',
  'Submit',
  'Add note',
  'Review update',
  'Mark as handled',
  'Correct outcome',
] as const

export type Box = Readonly<{ x: number; y: number; width: number; height: number }>

export type TargetKind = 'control' | 'menu-row' | 'pill'

export type MeasuredTarget = Readonly<{
  name: string
  role: string
  kind: TargetKind
  box: Box
}>

export type HorizontalOverflow = Readonly<{
  name: string
  scrollWidth: number
  clientWidth: number
}>

/** A shown element that reaches past the box of the ancestor that clips it. */
export type ClippedElement = Readonly<{
  name: string
  role: string
  box: Box
  clipper: string
  /** The clipper's padding box, left and right edges, in viewport px. */
  clipLeft: number
  clipRight: number
}>

/**
 * A run of text whose own line boxes reach past the box that holds it. Found
 * from the text, not the element: a block element stays its container's width
 * while a word it cannot break runs out of it, so no element box shows it.
 */
export type TextOverflow = Readonly<{
  /** The first words of the text node. */
  text: string
  /** The nearest ancestor that makes a box of its own, described like a clipper. */
  container: string
  /** The text's line boxes together, in viewport px. */
  box: Box
  /** The container's padding box, left and right edges. */
  containerLeft: number
  containerRight: number
}>

export type MeasuredPrimary = Readonly<{
  name: string
  box: Box
  inViewport: boolean
  /** What the button's centre hit-tests to when that is not the button; `null` when it is. */
  coveredBy: string | null
}>

/** An open portalled layer, judged against the viewport rather than the pane. */
export type MeasuredLayer = Readonly<{
  role: string
  name: string
  box: Box
  targets: ReadonlyArray<MeasuredTarget>
  overflows: ReadonlyArray<HorizontalOverflow>
  clips: ReadonlyArray<ClippedElement>
  textOverflows: ReadonlyArray<TextOverflow>
  /**
   * The layer itself, or a row in it, past a viewport edge. A row below the
   * bottom edge is not listed when a vertical scroller inside the layer holds
   * it: a long menu scrolls, and its rows are reachable.
   */
  outside: ReadonlyArray<Readonly<{ name: string; role: string; box: Box }>>
}>

export type PaneReport = Readonly<{
  paneCount: number
  viewport: Readonly<{ width: number; height: number }>
  documentScrollWidth: number
  /** Each pane's own box: a pane wider than the window is off screen however it scrolls. */
  paneBoxes: ReadonlyArray<Box>
  targets: ReadonlyArray<MeasuredTarget>
  overflows: ReadonlyArray<HorizontalOverflow>
  clips: ReadonlyArray<ClippedElement>
  textOverflows: ReadonlyArray<TextOverflow>
  primaries: ReadonlyArray<MeasuredPrimary>
  layers: ReadonlyArray<MeasuredLayer>
}>

type MeasureArgs = Readonly<{
  paneSelector: string
  interactiveSelector: string
  widgetRoles: ReadonlyArray<string>
  layerSelector: string
  rowListSelector: string
  pillNames: ReadonlyArray<string>
  primaryNames: ReadonlyArray<string>
  slack: number
  /** `false` while a probe has a layer open: only the layers are new. */
  includePane: boolean
  /** See `PaneOptions.hiddenRootBleedIsDecorative`. */
  hiddenRootBleedIsDecorative: boolean
  /** See `PaneOptions.hiddenInputUsesLabel`. */
  hiddenInputUsesLabel: boolean
  /** See `PaneOptions.textMustFitItsBox`. */
  textMustFitItsBox: boolean
}>

export type PaneOptions = Readonly<{
  /**
   * A pane whose own `overflow-x` is `hidden` or `clip` cuts what runs past it
   * rather than scrolling it, so its `scrollWidth` is not a way to put content
   * out of a finger's reach: probe 3 (`clippedIn`) is, and it already skips
   * what is `aria-hidden`. With this set, a hidden-overflow pane is judged by
   * probe 3 alone, which lets a decorative element bleed past the pane's edge
   * (the guest page's 390 px arch motif, centred on a 320 px phone) while a
   * real element that does is still flagged. Off by default: the Inbox panes
   * never relied on it.
   */
  hiddenRootBleedIsDecorative?: boolean
  /**
   * A native input that is visually hidden (a 1 px box, or under a clip) is
   * judged by the `<label>` around it, because that is what a finger presses.
   * Off by default: the Inbox pane judges an input by its own box, and a
   * hidden input in a big label would otherwise pass there.
   */
  hiddenInputUsesLabel?: boolean
  /**
   * Every run of text must lie inside the padding box of the element that
   * holds it (unless that element scrolls, or truncates with an ellipsis,
   * which both say "there is more"). The other probes compare ELEMENT boxes,
   * and a block element keeps its container's width while a long word runs out
   * of it — the German compound the guest page exists to survive — so with the
   * root's `scrollWidth` set aside (`hiddenRootBleedIsDecorative`) nothing
   * else sees it. Off by default: the Inbox panes were never measured this way.
   */
  textMustFitItsBox?: boolean
}>

/**
 * Runs INSIDE the story iframe (`page.evaluate` serialises it), so it may
 * reference nothing outside its own body — every constant arrives in `args`.
 *
 * Visibility is `checkVisibility`, which honours `display`, `hidden`,
 * `visibility` and `opacity`: both composer panels are force-mounted and one is
 * `hidden` (`reply-composer.tsx`), and a hidden panel's controls are not
 * targets.
 *
 * `aria-hidden` subtrees are skipped ONLY when the author put them there —
 * Radix's native bubble inputs and `VisuallyHidden` selects are 1 px
 * `aria-hidden` stand-ins, not targets. A subtree that Radix's `hideOthers`
 * marked while a modal layer is open carries `data-aria-hidden` beside it, and
 * stays measured: the pane under an open menu is still the pane.
 */
function measureInPage(args: MeasureArgs): PaneReport {
  const slack = args.slack
  const round = (n: number): number => Math.round(n * 10) / 10
  const toBox = (r: DOMRect): Box => ({
    x: round(r.x),
    y: round(r.y),
    width: round(r.width),
    height: round(r.height),
  })
  const boxOf = (el: Element): Box => toBox(el.getBoundingClientRect())
  const isShown = (el: Element): boolean =>
    el.getClientRects().length > 0 &&
    el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
    el.closest('[aria-hidden="true"]:not([data-aria-hidden])') === null &&
    el.closest('[inert]') === null
  const textOf = (el: Element): string =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  // An approximation of the accessible name, in the order the spec resolves
  // it; exact enough to find the control in the source from a red run.
  const nameOf = (el: Element): string => {
    const label = el.getAttribute('aria-label')?.trim()
    if (label) return label
    const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) =>
        id ? textOf(document.getElementById(id) ?? document.createElement('i')) : '',
      )
      .join(' ')
      .trim()
    if (labelledBy) return labelledBy
    const text = textOf(el)
    if (text) return text.slice(0, 80)
    const fallback = el.getAttribute('title') ?? el.getAttribute('placeholder')
    const slot = el.getAttribute('data-slot')
    return (
      fallback ?? `<${el.tagName.toLowerCase()}${slot ? ` data-slot="${slot}"` : ''}>`
    )
  }
  const roleOf = (el: Element): string =>
    el.getAttribute('role') ?? el.tagName.toLowerCase()
  // A clipper is usually a layout `div` with no name, so it is described by
  // what finds it in the source: its tag, slot, label and leading classes.
  const describe = (el: Element): string => {
    const label = el.getAttribute('aria-label')
    const slot = el.getAttribute('data-slot')
    const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/)
    const shown = classes.slice(0, 6).join(' ')
    return (
      `<${el.tagName.toLowerCase()}` +
      (label ? ` aria-label="${label}"` : '') +
      (slot ? ` data-slot="${slot}"` : '') +
      (shown ? ` class="${shown}${classes.length > 6 ? ' …' : ''}"` : '') +
      '>'
    )
  }
  // `[tabindex="0"]` finds custom controls, and also FOCUS STOPS that are not
  // pointer targets at all: Radix's `TabsContent` is `tabIndex={0}` so a
  // keyboard can enter the panel (WAI-ARIA tabs), and the AI proposal is a
  // `<p tabIndex={0}>` because a scroll region must be keyboard-reachable
  // (`reply-suggestion-preview.tsx:36-37,85`, WCAG 2.1.1). Neither does
  // anything when tapped, so WCAG 2.5.8 does not apply, and an empty reply
  // panel is 0 px tall by design (`reply-composer.tsx` keeps it, rather than
  // re-pointing the segment). Such an element is a target only when it carries
  // a widget role; a native control always is.
  const NATIVE_CONTROL = 'button, a[href], summary, input, textarea, select'
  const isTarget = (el: Element): boolean =>
    el.matches(NATIVE_CONTROL) || args.widgetRoles.includes(el.getAttribute('role') ?? '')

  const styles = new Map<Element, CSSStyleDeclaration>()
  const styleOf = (el: Element): CSSStyleDeclaration => {
    const cached = styles.get(el)
    if (cached !== undefined) return cached
    const computed = getComputedStyle(el)
    styles.set(el, computed)
    return computed
  }
  const isScrollValue = (value: string): boolean => value === 'auto' || value === 'scroll'

  const viewport = {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }
  const panes = [...document.querySelectorAll(args.paneSelector)].filter(isShown)
  const layers = [...document.querySelectorAll(args.layerSelector)]
    .filter(isShown)
    .filter(
      (layer) => !panes.some((pane) => pane.contains(layer) || layer.contains(pane)),
    )
  const topLayers = layers.filter(
    (layer) => !layers.some((other) => other !== layer && other.contains(layer)),
  )

  // A native input that is visually hidden (a 1 px box, or under a clip) is
  // not what a finger presses: the `<label>` around it is, and that is the
  // box that must be big enough. The guest page's stars are exactly this (a
  // `.ih-sr-only` radio inside a 54 px `<label>`), so without the substitution
  // every star would read as a 1x1 target. An input with no shown label keeps
  // its own box, so a hidden control with nothing to press still fails.
  const hitAreaOf = (el: Element): Element => {
    if (!args.hiddenInputUsesLabel || !el.matches('input')) return el
    const r = el.getBoundingClientRect()
    if (r.width > 1 && r.height > 1 && !isClippedAway(el)) return el
    const label = el.closest('label')
    return label !== null && isShown(label) ? label : el
  }

  const targetsIn = (root: Element, kindOf: (el: Element) => TargetKind) =>
    [...root.querySelectorAll(args.interactiveSelector)]
      .filter((el) => isShown(el) && isTarget(el))
      .map((el) => ({
        name: nameOf(el),
        role: roleOf(el),
        kind: kindOf(el),
        box: boxOf(hitAreaOf(el)),
      }))

  const paneKind = (el: Element): TargetKind =>
    el.tagName === 'BUTTON' &&
    el.getAttribute('aria-expanded') === 'false' &&
    args.pillNames.includes(nameOf(el))
      ? 'pill'
      : 'control'
  const layerKind = (el: Element): TargetKind =>
    el.closest(args.rowListSelector) === null ? 'control' : 'menu-row'

  // Probe 1 and 2 of the header: the root itself, whatever its `overflow`,
  // and every horizontal SCROLLER inside it. A `truncate` span is
  // `overflow: hidden`, not a scroller; probe 3 decides about it.
  const overflowsIn = (
    root: Element,
    rootName: string,
    rootBleedIsDecorative = false,
  ): HorizontalOverflow[] => {
    const scrollers = [...root.querySelectorAll('*')].filter(
      (el) => isShown(el) && isScrollValue(styleOf(el).overflowX),
    )
    const rootCuts = ['hidden', 'clip'].includes(styleOf(root).overflowX)
    return (rootBleedIsDecorative && rootCuts ? scrollers : [root, ...scrollers])
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => ({
        name: el === root ? rootName : isTarget(el) ? nameOf(el) : describe(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
  }

  // Probe 3 of the header. The ancestor whose `overflow` can clip `el` is the
  // nearest one on its CONTAINING-BLOCK chain, not merely the nearest one: an
  // absolutely positioned descendant escapes the overflow of every static
  // ancestor between it and its positioned one, and a fixed one escapes all of
  // them unless a transform, filter, perspective or paint containment makes an
  // ancestor its containing block. `overflow` does not apply to an inline or
  // `display: contents` box, whatever it computes to.
  const makesContainingBlock = (s: CSSStyleDeclaration, forFixed: boolean): boolean =>
    (!forFixed && s.position !== 'static') ||
    s.transform !== 'none' ||
    s.filter !== 'none' ||
    s.perspective !== 'none' ||
    /paint|layout|strict|content/.test(s.contain)
  const clipperOf = (el: Element): Element | null => {
    let position = styleOf(el).position
    for (let a = el.parentElement; a !== null; a = a.parentElement) {
      const s = styleOf(a)
      if (position === 'fixed' && !makesContainingBlock(s, true)) continue
      if (position === 'absolute' && !makesContainingBlock(s, false)) continue
      const clips =
        s.overflowX !== 'visible' && s.display !== 'inline' && s.display !== 'contents'
      if (clips) return a
      position = s.position
    }
    return null
  }
  // A clipper that scrolls is probe 2's (its `scrollWidth` already says so,
  // and a scrolled-away row is reachable). Two clippers are deliberate and
  // exempt: `text-overflow: ellipsis` — `truncate`, row 20's shipped answer to
  // a long status, which says "there is more" in the text itself — and a
  // visually hidden label, never meant to be seen: a box of 1 px or less
  // (Radix's `VisuallyHidden`), or anything under a `clip-path` / `clip`
  // (Tailwind 4's `sr-only` is `clip-path: inset(50%)`, and measured it is not
  // always 1 px: the sheet's `SheetHeader` is `p-4 sr-only`, whose padding
  // outranks the utility's, so it is a 32x32 box at x=0 inside a sheet whose
  // border starts its clip at x=1). An `svg`'s children are icon geometry
  // inside a viewBox, not layout, and are skipped.
  const hiddenByClip = new Map<Element, boolean>()
  const isClippedAway = (el: Element): boolean => {
    const cached = hiddenByClip.get(el)
    if (cached !== undefined) return cached
    const s = styleOf(el)
    const own = s.clipPath !== 'none' || (s.clip !== 'auto' && s.clip !== '')
    const result = own || (el.parentElement !== null && isClippedAway(el.parentElement))
    hiddenByClip.set(el, result)
    return result
  }
  const clippedIn = (root: Element): ClippedElement[] => {
    const flagged = new Map<Element, Element>()
    const found: ClippedElement[] = []
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el instanceof SVGElement && el.ownerSVGElement !== null) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1 || !isShown(el) || isClippedAway(el)) continue
      const clipper = clipperOf(el)
      if (clipper === null) continue
      const cs = styleOf(clipper)
      if (isScrollValue(cs.overflowX) || cs.textOverflow === 'ellipsis') continue
      const c = clipper.getBoundingClientRect()
      if (c.width <= 1 || c.height <= 1) continue
      const clipLeft = c.left + clipper.clientLeft
      const clipRight = clipLeft + clipper.clientWidth
      if (r.left >= clipLeft - slack && r.right <= clipRight + slack) continue
      const parentFlagged = el.parentElement !== null && flagged.get(el.parentElement)
      flagged.set(el, clipper)
      // One line per clipped subtree: a clipped button's label and icon are
      // the button's problem, already reported.
      if (parentFlagged === clipper) continue
      found.push({
        name: isTarget(el) ? nameOf(el) : describe(el),
        role: roleOf(el),
        box: toBox(r),
        clipper: describe(clipper),
        clipLeft: round(clipLeft),
        clipRight: round(clipRight),
      })
    }
    return found
  }

  // Probe 5: the text itself. Each text node's line boxes (a Range, so a word
  // that overflows its container is measured where it is painted) against the
  // padding box of its nearest ancestor that makes a box. A scroller is probe
  // 2's, `text-overflow: ellipsis` is deliberate (probe 3 exempts it the same
  // way), and text that is visually hidden or an svg's own is not read.
  const boxOwnerOf = (el: Element): Element => {
    let owner: Element = el
    while (
      ['inline', 'contents'].includes(styleOf(owner).display) &&
      owner.parentElement !== null
    ) {
      owner = owner.parentElement
    }
    return owner
  }
  const textOverflowsIn = (root: Element): TextOverflow[] => {
    if (!args.textMustFitItsBox) return []
    const found: TextOverflow[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (parent === null || text === '' || parent.closest('svg') !== null) continue
      // `aria-hidden` says nothing about what is painted: the rating scale's
      // end words are `aria-hidden` duplicates of the radios' names, and they
      // are on the screen. Only what is not painted at all is skipped.
      const painted =
        parent.getClientRects().length > 0 &&
        parent.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
        parent.closest('[inert]') === null
      if (!painted || isClippedAway(parent)) continue
      const owner = boxOwnerOf(parent)
      const ownerStyle = styleOf(owner)
      if (isScrollValue(ownerStyle.overflowX) || ownerStyle.textOverflow === 'ellipsis') {
        continue
      }
      range.selectNodeContents(node)
      const lines = [...range.getClientRects()].filter((r) => r.width > 0)
      if (lines.length === 0) continue
      const left = Math.min(...lines.map((r) => r.left))
      const right = Math.max(...lines.map((r) => r.right))
      const o = owner.getBoundingClientRect()
      if (o.width <= 1) continue
      const containerLeft = o.left + owner.clientLeft
      const containerRight = containerLeft + owner.clientWidth
      if (left >= containerLeft - slack && right <= containerRight + slack) continue
      const top = Math.min(...lines.map((r) => r.top))
      const bottom = Math.max(...lines.map((r) => r.bottom))
      found.push({
        text: text.length > 40 ? `${text.slice(0, 40)}…` : text,
        container: describe(owner),
        box: toBox(new DOMRect(left, top, right - left, bottom - top)),
        containerLeft: round(containerLeft),
        containerRight: round(containerRight),
      })
    }
    return found
  }

  const outsideViewport = (r: DOMRect): boolean =>
    r.left < -slack ||
    r.top < -slack ||
    r.right > viewport.width + slack ||
    r.bottom > viewport.height + slack
  // Probe 4 of the header.
  const layerIn = (layer: Element): MeasuredLayer => {
    const scrollsVertically = (el: Element): boolean => {
      for (let a = el.parentElement; a !== null; a = a.parentElement) {
        if (isScrollValue(styleOf(a).overflowY)) return true
        if (a === layer) return false
      }
      return false
    }
    const targets = targetsIn(layer, layerKind)
    const rows = [...layer.querySelectorAll(args.interactiveSelector)].filter(
      (el) => isShown(el) && isTarget(el),
    )
    const rowsOutside = rows.filter((el) => {
      const r = el.getBoundingClientRect()
      const offHorizontally = r.left < -slack || r.right > viewport.width + slack
      const offVertically = r.top < -slack || r.bottom > viewport.height + slack
      return offHorizontally || (offVertically && !scrollsVertically(el))
    })
    const name = nameOf(layer)
    return {
      role: roleOf(layer),
      name: name.length > 60 ? `${name.slice(0, 60)}…` : name,
      box: boxOf(layer),
      targets,
      overflows: overflowsIn(layer, `the ${roleOf(layer)} itself`),
      clips: clippedIn(layer),
      textOverflows: textOverflowsIn(layer),
      outside: [
        ...(outsideViewport(layer.getBoundingClientRect())
          ? [
              {
                name: `the ${roleOf(layer)} itself`,
                role: roleOf(layer),
                box: boxOf(layer),
              },
            ]
          : []),
        ...rowsOutside.map((el) => ({
          name: nameOf(el),
          role: roleOf(el),
          box: boxOf(el),
        })),
      ],
    }
  }

  const primariesIn = (pane: Element): MeasuredPrimary[] =>
    [...pane.querySelectorAll('button')]
      .filter((el) => isShown(el) && args.primaryNames.includes(nameOf(el)))
      .map((el) => {
        const box = boxOf(el)
        const inViewport = !outsideViewport(el.getBoundingClientRect())
        // Hit-testable: the topmost element at the button's centre is the
        // button or inside it. Catches a primary covered by a sticky row, an
        // open layer, or a clip that leaves the box nominally on screen.
        //
        // `elementFromPoint` skips `pointer-events: none`, and the shared
        // `Button` sets exactly that when disabled
        // (`ui/button.tsx` `disabled:pointer-events-none`) — so an empty
        // composer's `Submit for approval` would read as covered by its own
        // row. The button takes pointer events for the one synchronous probe
        // and gets its inline style back before anything can paint.
        const probe = (): Element | null => {
          const inline = (el as HTMLElement).style
          const previous = inline.getPropertyValue('pointer-events')
          const priority = inline.getPropertyPriority('pointer-events')
          inline.setProperty('pointer-events', 'auto', 'important')
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          )
          inline.setProperty('pointer-events', previous, priority)
          return hit
        }
        const hit = inViewport ? probe() : null
        // A modal layer the play left open covers the pane ON PURPOSE: the
        // feedback pane's plays end with the handling dialog open, whose
        // overlay (`data-slot="dialog-overlay"`) is over the whole page. That
        // is the dialog's moment, not a primary pushed under something, and
        // the layer itself is judged below. Only a cover that is neither an
        // open layer nor a layer's overlay is a failure.
        const underOpenLayer =
          hit !== null &&
          (topLayers.some((layer) => layer.contains(hit)) ||
            /-overlay$/.test(hit.getAttribute('data-slot') ?? ''))
        const coveredBy =
          !inViewport || hit === null || el.contains(hit) || underOpenLayer
            ? hit === null && inViewport
              ? 'nothing (outside the document)'
              : null
            : `${nameOf(hit)} (${roleOf(hit)})`
        return { name: nameOf(el), box, inViewport, coveredBy }
      })

  const paneName = `the pane (${args.paneSelector})`
  const include = <T>(measure: () => T[]): T[] => (args.includePane ? measure() : [])
  return {
    paneCount: panes.length,
    viewport,
    documentScrollWidth: document.documentElement.scrollWidth,
    paneBoxes: panes.map(boxOf),
    targets: include(() => panes.flatMap((pane) => targetsIn(pane, paneKind))),
    overflows: include(() =>
      panes.flatMap((pane) =>
        overflowsIn(pane, paneName, args.hiddenRootBleedIsDecorative),
      ),
    ),
    clips: include(() => panes.flatMap(clippedIn)),
    textOverflows: include(() => panes.flatMap(textOverflowsIn)),
    primaries: include(() => panes.flatMap(primariesIn)),
    layers: topLayers.map(layerIn),
  }
}

function measureArgs(
  paneSelector: string,
  includePane: boolean,
  options: PaneOptions = {},
): MeasureArgs {
  return {
    paneSelector,
    interactiveSelector: INTERACTIVE_SELECTOR,
    widgetRoles: WIDGET_ROLES,
    layerSelector: LAYER_SELECTOR,
    rowListSelector: ROW_LIST_SELECTOR,
    pillNames: COLLAPSED_PILL_NAMES,
    primaryNames: COMPOSER_PRIMARY_NAMES,
    slack: POSITION_SLACK_PX,
    includePane,
    hiddenRootBleedIsDecorative: options.hiddenRootBleedIsDecorative === true,
    hiddenInputUsesLabel: options.hiddenInputUsesLabel === true,
    textMustFitItsBox: options.textMustFitItsBox === true,
  }
}

/** The pane as it is now, and every layer open over it. */
export function measurePane(
  page: Page,
  paneSelector: string,
  options: PaneOptions = {},
): Promise<PaneReport> {
  return page.evaluate(measureInPage, measureArgs(paneSelector, true, options))
}

/** Only the open layers — what a probe just opened over an already measured pane. */
export async function measureLayers(
  page: Page,
  paneSelector: string,
): Promise<ReadonlyArray<MeasuredLayer>> {
  const report = await page.evaluate(measureInPage, measureArgs(paneSelector, false))
  return report.layers
}

type LayerCountArgs = Readonly<{
  pane: string
  layer: string
  /** Resolve `true` once the count is above this, when given. */
  above?: number
  /** Resolve `true` once the count is below this, when given. */
  below?: number
}>

/**
 * Runs in the iframe. The same filter `measureInPage` applies — shown, and
 * neither inside the pane nor holding it — so "a layer opened" and "a layer was
 * measured" cannot disagree. Returns the count, or with `above` / `below` a
 * predicate for `page.waitForFunction`.
 */
function openLayersInPage(args: LayerCountArgs): number | boolean {
  const panes = [...document.querySelectorAll(args.pane)]
  const count = [...document.querySelectorAll(args.layer)].filter(
    (el) =>
      el.getClientRects().length > 0 &&
      el.checkVisibility({ visibilityProperty: true }) &&
      !panes.some((pane) => pane.contains(el) || el.contains(pane)),
  ).length
  if (args.above !== undefined) return count > args.above
  if (args.below !== undefined) return count < args.below
  return count
}

/** How many layers are open outside the pane. */
export async function countOpenLayers(page: Page, paneSelector: string): Promise<number> {
  const count = await page.evaluate(openLayersInPage, {
    pane: paneSelector,
    layer: LAYER_SELECTOR,
  })
  return Number(count)
}

/**
 * Wait, on the DOM, until more than `above` (or fewer than `below`) layers are
 * open. Resolves `false` instead of throwing when `timeoutMs` passes first.
 */
export async function waitForLayerCount(
  page: Page,
  paneSelector: string,
  bound: Readonly<{ above: number } | { below: number }>,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      openLayersInPage,
      { pane: paneSelector, layer: LAYER_SELECTOR, ...bound },
      { timeout: timeoutMs },
    )
    return true
  } catch (error: unknown) {
    // Only the timeout is an answer ("it did not open"); a closed page or a
    // navigation is the harness failing, and must say so.
    if (error instanceof errors.TimeoutError) return false
    throw error
  }
}
