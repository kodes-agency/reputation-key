// The class lists of a SectionNav, per frame and per presentation.
//
// A nav is a strip (one scrolling row) or a list (a column), and `auto` is a strip
// that becomes a list once the container it sits in is wide enough. Tailwind finds
// a class only when it is written out whole, so a prefixed class cannot be computed
// from a plain one: every slot lists its classes four ways.
//
// - `base`: both presentations.
// - `strip`: the row only.
// - `list`: the column only (the classes that turn the row into a column, resets
//   included).
// - `auto`: the row, then each `list` class behind the container variant, written
//   out. `section-nav-styles.test.ts` fails when `auto` is not exactly that, so the
//   two cannot drift.
//
// Two frames, because the two surfaces that use a nav sit differently:
//
// - `rail`: a full-bleed workspace (the Portal editor). The strip is a bordered band
//   on the page gutter; the list is a bordered 18rem column that stays in view while
//   the section scrolls, from a 72rem container (room for the list, a form and the
//   live preview).
// - `inline`: a page's own content (Property settings). The strip scrolls to the
//   screen edge on a phone; the list is a 14rem column beside the content, from a
//   48rem container.
import { PAGE_GUTTER_BLEED_PHONE, PAGE_GUTTER_X } from '#/components/layout/page-shell'

export type SectionNavFrame = 'rail' | 'inline'
export type SectionNavPresentation = 'list' | 'strip' | 'auto'
export type SectionNavSlot =
  'nav' | 'scroller' | 'group' | 'heading' | 'list' | 'summary' | 'footer'

type SlotClasses = Readonly<{
  base: string
  strip: string
  list: string
  auto: string
}>

type FrameStyles = Readonly<Record<SectionNavSlot, SlotClasses>>

/** The slots that are the same in both frames bar the container variant. */
const SHARED_BASE = {
  heading: 'px-3 pb-1 text-xs font-medium text-muted-foreground',
  list: 'flex gap-1',
} as const

export const SECTION_NAV_STYLES: Readonly<Record<SectionNavFrame, FrameStyles>> = {
  rail: {
    nav: {
      base: '',
      strip: 'border-b',
      list: 'w-72 shrink-0 self-stretch border-r border-b-0',
      auto: 'border-b @6xl:w-72 @6xl:shrink-0 @6xl:self-stretch @6xl:border-r @6xl:border-b-0',
    },
    scroller: {
      base: 'relative flex scroll-px-6',
      strip: `${PAGE_GUTTER_X} gap-1 overflow-x-auto py-2 [scrollbar-width:none]`,
      list: 'sticky top-0 flex-col gap-5 overflow-visible px-3 py-5',
      auto: `${PAGE_GUTTER_X} gap-1 overflow-x-auto py-2 [scrollbar-width:none] @6xl:sticky @6xl:top-0 @6xl:flex-col @6xl:gap-5 @6xl:overflow-visible @6xl:px-3 @6xl:py-5`,
    },
    group: { base: '', strip: 'contents', list: 'block', auto: 'contents @6xl:block' },
    heading: {
      base: SHARED_BASE.heading,
      strip: 'hidden',
      list: 'block',
      auto: 'hidden @6xl:block',
    },
    list: {
      base: SHARED_BASE.list,
      strip: '',
      list: 'flex-col',
      auto: '@6xl:flex-col',
    },
    summary: {
      base: 'items-center gap-1 truncate text-xs font-normal text-muted-foreground',
      strip: 'hidden',
      list: 'flex',
      auto: 'hidden @6xl:flex',
    },
    footer: {
      base: 'px-3 text-xs text-muted-foreground',
      strip: 'hidden',
      list: 'block',
      auto: 'hidden @6xl:block',
    },
  },
  inline: {
    nav: {
      base: 'min-w-0',
      strip: '',
      list: 'sticky top-4',
      auto: '@3xl:sticky @3xl:top-4',
    },
    scroller: {
      base: 'relative flex scroll-px-6',
      strip: `${PAGE_GUTTER_BLEED_PHONE} gap-1 overflow-x-auto py-1 md:-mx-1 md:px-1 [scrollbar-width:none]`,
      list: 'mx-0 flex-col gap-5 overflow-visible px-0 py-0',
      auto: `${PAGE_GUTTER_BLEED_PHONE} gap-1 overflow-x-auto py-1 md:-mx-1 md:px-1 [scrollbar-width:none] @3xl:mx-0 @3xl:flex-col @3xl:gap-5 @3xl:overflow-visible @3xl:px-0 @3xl:py-0`,
    },
    group: { base: '', strip: 'contents', list: 'block', auto: 'contents @3xl:block' },
    heading: {
      base: SHARED_BASE.heading,
      strip: 'hidden',
      list: 'block',
      auto: 'hidden @3xl:block',
    },
    list: {
      base: SHARED_BASE.list,
      strip: '',
      list: 'flex-col',
      auto: '@3xl:flex-col',
    },
    summary: {
      base: 'text-xs font-normal text-muted-foreground',
      strip: 'hidden',
      list: 'block',
      auto: 'hidden @3xl:block',
    },
    footer: {
      base: 'text-xs text-muted-foreground',
      strip: 'hidden',
      list: 'block',
      auto: 'hidden @3xl:block',
    },
  },
}

/**
 * The container the nav and its content sit in: the outer element declares it (a
 * container cannot restyle itself), the inner one is the layout that changes with
 * its width. A frame's `auto` presentation waits for the same width.
 */
export const SECTION_NAV_LAYOUT: Readonly<
  Record<SectionNavFrame, Readonly<{ outer: string; inner: string }>>
> = {
  rail: {
    outer: 'flex min-h-full flex-col',
    inner: 'flex flex-1 flex-col @6xl:flex-row',
  },
  inline: {
    outer: '',
    inner: 'grid gap-6 @3xl:grid-cols-[14rem_minmax(0,1fr)] @3xl:items-start',
  },
}

/** The container variant a frame's `auto` presentation waits for. */
export const SECTION_NAV_LIST_FROM: Readonly<Record<SectionNavFrame, string>> = {
  rail: '@6xl:',
  inline: '@3xl:',
}

/** The whole class list of one slot, in one presentation. */
export function sectionNavClasses(
  frame: SectionNavFrame,
  slot: SectionNavSlot,
  presentation: SectionNavPresentation,
): string {
  const classes = SECTION_NAV_STYLES[frame][slot]
  return [classes.base, classes[presentation]].filter(Boolean).join(' ')
}

/**
 * A row (and its icon) wears the same classes in every frame, so the active fill,
 * hover and focus are one recipe. The fill is the main sidebar's accent-muted one and
 * is drawn from the `aria-current` the nav sets, so what is shown and what is
 * announced cannot differ. Height: the touch token (44px, 36px in a compact
 * workspace) below `md`; from `md` a rail's rows keep it (they are touch targets on
 * a tablet strip) and an inline nav's are 36px.
 */
export const SECTION_NAV_ROW =
  'group focus-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:hover:bg-accent'

export const SECTION_NAV_ROW_HEIGHT: Readonly<Record<SectionNavFrame, string>> = {
  rail: 'min-h-(--control-touch)',
  inline: 'min-h-9 max-md:min-h-(--control-touch)',
}

export const SECTION_NAV_ICON =
  'size-4 shrink-0 text-muted-foreground group-aria-[current=page]:text-(--accent)'
