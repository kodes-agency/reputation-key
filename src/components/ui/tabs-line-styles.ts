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
// `data-state="active"`, which Radix writes and `LinkTab` writes too, so one
// class string serves both elements.

/**
 * A tab is `--control-touch` tall (44px, 36px in a compact workspace) at every
 * width, as the Portal workspace strip it came from was: it is navigation, so it
 * keeps the larger target on a desktop too. The focus outline is inset: a list
 * that scrolls sideways clips an outer ring at its top and bottom.
 */
export const LINE_TAB_CLASS =
  "relative inline-flex min-h-(--control-touch) items-center justify-center gap-1.5 px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:font-medium data-[state=active]:text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/** The list the tabs sit in: transparent, with the baseline the underline rests on. */
export const LINE_TABS_LIST_CLASS = 'w-full justify-start gap-1 border-b bg-transparent'
