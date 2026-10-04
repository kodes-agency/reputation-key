// The underline look of a page-level view switch, apart from the element that
// carries it, so the two ways to draw one share a single recipe: `TabsTrigger`
// in the `line` variant (a tablist that swaps a panel in the same document, such
// as the notification filters) and `LinkTab` (links in a navigation landmark,
// for views that are a route). Decision 7 of the UI consistency plan: a page's
// sibling views wear this look, and the grey pill belongs to in-component modes
// (a composer's Reply / Note, a dialog's choice).
//
// The recipe is the Portal workspace strip it was lifted from: muted ink, the
// chosen tab in foreground and medium weight, and a 2px primary underline with
// rounded ends that sits on the list's baseline. The state is read from
// `data-state="active"`, which Radix writes and `LinkTab` writes too (from the
// `current` it gives the link), so one class string serves both elements.

/**
 * A tab is as tall as any control: 36px from `md`, and `--control-touch` below it
 * (44px, 36px in a compact workspace), the density decision of the plan. The focus
 * outline is inset, and that is deliberate (NAV-05): a tab sits flush against the
 * list's baseline in a row that scrolls sideways, which clips an outer ring at its
 * top and bottom. The section navs' rows have padding around them for the shared
 * `focus-ring` and wear that instead.
 */
export const LINE_TAB_CLASS =
  "relative inline-flex min-h-9 max-md:min-h-(--control-touch) items-center justify-center gap-1.5 px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-medium data-[state=active]:text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/** The list the tabs sit in: transparent, with the baseline the underline rests on. */
export const LINE_TABS_LIST_CLASS = 'w-full justify-start gap-1 border-b bg-transparent'
