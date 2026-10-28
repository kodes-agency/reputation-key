import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'
import { Skeleton } from '#/components/ui/skeleton'
import type { LoadingShape } from './page-identity'
import { PAGE_GUTTER_X } from './page-shell'

// The loading state's bodies: one placeholder per kind of page, so a slow load
// holds the place of the content that replaces it (the same columns, the same
// first block) instead of one generic slab. `PageState` picks the shape from the
// page's identity (`loadingShapeOf`, page-identity) and draws the header above it.
//
// Two shapes are not a body below a header: the workspace and the Inbox are
// full-bleed surfaces that own their frame, so they draw their own header, tabs
// and panes and `PageState` puts neither a `PageShell` nor a gutter around them.
//
// These stay free of feature code: they sit in the first-paint closure with every
// route fallback. The breakpoints of the two surfaces are the surfaces' own, so
// they are spelled in classes here and must change with them: the portal editor
// splits at `@4xl`, widens its preview at `@6xl` and shows its section column at
// `@7xl` (`portal-editor`, `section-nav-styles`); the Inbox shows its queue rail
// from `@min-[1022px]`, the width of a rail, a list and a detail pane at their
// minimums, which is the floor `use-inbox-compact-layout` measures beside the sidebar.

type BodyProps = Readonly<{
  /** What a screen reader hears while the page loads. */
  label: string
}>

/** The body root every shape shares: busy, announced politely, named for its shape. */
function BusyRegion({
  shape,
  label,
  className,
  children,
}: Readonly<{
  shape: LoadingShape
  label: string
  className?: string
  children: ReactNode
}>) {
  return (
    <div
      data-loading-shape={shape}
      aria-busy="true"
      aria-live="polite"
      className={className}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** A page of figures: a row of four tiles, a heading and a chart. */
function ScorecardBody({ label }: BodyProps) {
  return (
    <BusyRegion shape="scorecard" label={label} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-64" />
    </BusyRegion>
  )
}

/** A list: its toolbar, then a bordered table with a header row and rows. */
function ListBody({ label }: BodyProps) {
  return (
    <BusyRegion shape="list" label={label} className="space-y-4">
      <div className="flex gap-3">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="hidden h-10 w-28 sm:block" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-16 border-t p-3">
            <Skeleton className="h-full" />
          </div>
        ))}
      </div>
    </BusyRegion>
  )
}

/** One bordered card of a settings page: a title, a sentence and a field. */
function CardPlaceholder() {
  return (
    <div className="space-y-4 rounded-xl border p-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-10" />
    </div>
  )
}

/** A column of cards: the settings pages and the goals list. */
function CardsBody({ label }: BodyProps) {
  return (
    <BusyRegion shape="cards" label={label} className="space-y-4">
      <CardPlaceholder />
      <CardPlaceholder />
    </BusyRegion>
  )
}

/** A form and the preview or the portals it affects beside it from `lg`. */
function SplitBody({ label }: BodyProps) {
  return (
    <BusyRegion
      shape="split"
      label={label}
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]"
    >
      <div className="min-w-0 space-y-4">
        <CardPlaceholder />
        <CardPlaceholder />
      </div>
      <Skeleton className="h-96" />
    </BusyRegion>
  )
}

/** The loaded page's title, in the same place and size its header draws it. */
function HeaderTitle({ title }: Readonly<{ title: string }>) {
  return <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
}

/**
 * The Portal workspace while it loads: the editor's own header band, tab strip
 * and body, so the page does not jump from a centred column to an edge-to-edge
 * editor. The measures are the loaded header's (a 65 px band, a 37 px strip, a
 * 288 px section column, a 26 or 30 rem preview). The way back is a block of
 * 140 px: its label is 136 px in the page's font and 141 in the fallback font
 * before the web font arrives, so the title lands within 4 px either way.
 */
function WorkspaceBody({ title, label }: BodyProps & Readonly<{ title?: string }>) {
  return (
    <BusyRegion
      shape="workspace"
      label={label}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 sm:gap-x-4 sm:gap-y-2 sm:py-3',
          PAGE_GUTTER_X,
        )}
      >
        <Skeleton className="-ml-2 h-8 w-11 sm:w-[8.75rem]" />
        <div className="min-w-0 flex-1 basis-0 border-l pl-3 sm:basis-56 sm:pl-4">
          {title ? <HeaderTitle title={title} /> : <Skeleton className="h-6 w-40" />}
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <div className="flex items-center gap-3 sm:ml-auto">
          <Skeleton className="hidden h-8 w-28 sm:block" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <div
        className={cn(
          'flex h-[37px] shrink-0 items-center gap-6 border-b',
          PAGE_GUTTER_X,
        )}
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-4 w-12" />
        ))}
      </div>
      <div className="@container min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full flex-col @7xl:flex-row">
          <div
            className={cn(
              'flex shrink-0 gap-2 overflow-hidden border-b py-2',
              'items-center @7xl:w-72 @7xl:flex-col @7xl:items-stretch @7xl:gap-3 @7xl:border-r @7xl:border-b-0 @7xl:px-3 @7xl:py-5',
              PAGE_GUTTER_X,
            )}
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-28 shrink-0 @7xl:w-auto" />
            ))}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col @4xl:flex-row">
            <div className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
              <div className="mx-auto max-w-2xl space-y-6">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-10" />
                <Skeleton className="h-52" />
              </div>
            </div>
            <div className="hidden bg-muted/20 px-6 py-5 @4xl:block @4xl:w-[26rem] @4xl:shrink-0 @4xl:border-l @6xl:w-[30rem]">
              <Skeleton className="mb-4 h-5 w-20" />
              <Skeleton className="mx-auto h-[34rem] w-72 rounded-[2.2rem]" />
            </div>
          </div>
        </div>
      </div>
    </BusyRegion>
  )
}

/** A row of the Inbox list, 78 px as the loaded rows are. */
function InboxRowPlaceholder() {
  return (
    <div className="flex h-[78px] items-center gap-3 border-b px-3 py-3 max-md:px-4">
      <Skeleton className="size-4 rounded max-md:hidden" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

/**
 * The Inbox (and a Property's Reviews) while it loads: queue rail, list and
 * detail pane in a container, the rail from `@min-[1022px]` (the Inbox's own
 * floor, `use-inbox-compact-layout`). Below that the list stands alone with the
 * queues as a strip of chips above it, as the compact layout does (on a phone the header row is the scope, and the queue's name is read, not drawn).
 */
function InboxBody({ title, label }: BodyProps & Readonly<{ title?: string }>) {
  return (
    <BusyRegion shape="inbox" label={label} className="@container h-full min-w-0">
      <div className="flex h-full min-w-0">
        <div className="hidden h-full w-56 shrink-0 flex-col gap-1 border-r px-3 py-4 @min-[1022px]:flex">
          <Skeleton className="mb-3 h-8" />
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
        <div className="flex h-full min-w-0 flex-1 flex-col @min-[1022px]:flex-none @min-[1022px]:basis-[25rem] @min-[1022px]:shrink">
          <div className="flex h-11 shrink-0 items-center gap-3 border-b px-4 md:h-14 @min-[1022px]:px-3">
            <div className="min-w-0 flex-1 space-y-1">
              {title ? (
                <h1 className="truncate text-sm font-semibold max-md:sr-only">{title}</h1>
              ) : (
                <Skeleton className="h-5 w-24 max-md:hidden" />
              )}
              <Skeleton className="h-3 w-28 max-md:h-5" />
            </div>
            <Skeleton className="size-8" />
            <Skeleton className="h-8 w-36 max-md:w-16" />
          </div>
          <div className="flex h-[43px] shrink-0 items-center gap-2 border-b px-4 @min-[1022px]:hidden">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {Array.from({ length: 8 }).map((_, index) => (
              <InboxRowPlaceholder key={index} />
            ))}
          </div>
        </div>
        <div className="hidden w-1.5 shrink-0 bg-border @min-[1022px]:block" />
        <div className="hidden min-w-0 flex-1 @min-[1022px]:block" />
      </div>
    </BusyRegion>
  )
}

/** Shapes that own the whole surface: no `PageShell`, no gutter, no header above. */
export function isSurfaceShape(shape: LoadingShape): boolean {
  return shape === 'workspace' || shape === 'inbox'
}

/** The body for a page that is loading, in the shape of the page it stands in for. */
export function LoadingShapeBody({
  shape,
  label,
  title,
}: Readonly<{ shape: LoadingShape; label: string; title?: string }>) {
  switch (shape) {
    case 'scorecard':
      return <ScorecardBody label={label} />
    case 'list':
      return <ListBody label={label} />
    case 'cards':
      return <CardsBody label={label} />
    case 'split':
      return <SplitBody label={label} />
    case 'workspace':
      return <WorkspaceBody label={label} title={title} />
    case 'inbox':
      return <InboxBody label={label} title={title} />
  }
}
