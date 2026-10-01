// How tightly the Portals table sets itself. The overview has the page's whole
// width and becomes a table from a 56 rem container (`@4xl`); a group's page
// gives its table the left column beside the goal and history (board 13), about
// 46 rem on a laptop, so it becomes a table from 42 rem (`@2xl`) with narrower
// columns and an icon for Share. One DOM for both: only the class names differ.
//
// Every class is written out in full here (never assembled), so Tailwind sees
// each one. A table that is narrower than its breakpoint is a stack of cards in
// either density.
import { createContext, useContext } from 'react'

export type OverviewDensity = 'regular' | 'compact'

export type OverviewClasses = Readonly<{
  /** The container that holds the table. */
  container: string
  table: string
  header: string
  /** One group's rows. */
  body: string
  /** A Portal's row, as a card and as a table row. */
  card: string
  /** The Portal's name cell and the Portal's cells that follow it. */
  nameCell: string
  managersCell: string
  buttonsCell: string
  menuCell: string
  /** Shown as a card only: the one summary line, and the pencil on Edit. */
  cardOnly: string
  /** The words of Share: beside its icon in the regular table, only for a screen reader in the compact one. */
  shareLabel: string
  /** A measure's figure, and the words that fill the columns of a draft. */
  measureCell: string
  measureSpan: string
  /** A column header of a measure. */
  measureHead: string
  /** The head of a group. */
  groupRow: string
  groupName: string
  groupSummary: string
  groupSpacer: string
  groupActions: string
}>

export const OVERVIEW_CLASSES: Readonly<Record<OverviewDensity, OverviewClasses>> = {
  regular: {
    container:
      '@container transition-opacity @4xl:overflow-hidden @4xl:rounded-lg @4xl:border @4xl:bg-card',
    table: 'block @4xl:table',
    header: 'hidden @4xl:table-header-group',
    body: 'block space-y-3 pb-3 @4xl:table-row-group @4xl:space-y-0 @4xl:pb-0',
    card:
      'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-3 rounded-lg border bg-card p-4 ' +
      '@4xl:table-row @4xl:rounded-none @4xl:border-0 @4xl:border-b @4xl:bg-transparent @4xl:p-0',
    nameCell:
      'col-start-1 row-start-1 h-auto min-w-0 p-0 text-left font-normal whitespace-normal @4xl:table-cell @4xl:px-4 @4xl:py-3',
    managersCell: 'hidden p-0 @4xl:table-cell @4xl:w-36 @4xl:px-4 @4xl:py-3',
    buttonsCell:
      'col-span-2 row-start-2 grid grid-cols-2 gap-2 p-0 @4xl:table-cell @4xl:w-48 @4xl:px-2 @4xl:py-3 @4xl:text-right [&>*]:justify-center @4xl:[&>*]:ml-2',
    menuCell:
      'col-start-2 row-start-1 -mt-2 -mr-2 self-start p-0 @4xl:mt-0 @4xl:mr-0 @4xl:table-cell @4xl:w-12 @4xl:px-2 @4xl:py-3 @4xl:text-right',
    cardOnly: '@4xl:hidden',
    shareLabel: '',
    measureCell:
      'hidden px-2 py-3 text-right text-sm tabular-nums @4xl:table-cell @4xl:w-24',
    measureSpan: 'hidden px-2 py-3 text-sm text-muted-foreground @4xl:table-cell',
    measureHead:
      'h-10 px-2 text-right text-xs leading-tight whitespace-normal text-muted-foreground',
    groupRow:
      'relative block border-0 bg-transparent px-1 pt-2 hover:bg-transparent @4xl:table-row @4xl:border-b @4xl:bg-muted/40 @4xl:px-0 @4xl:pt-0 @4xl:hover:bg-muted/40',
    groupName:
      'block h-auto p-0 pr-11 text-left font-normal @4xl:table-cell @4xl:px-2 @4xl:py-2',
    groupSummary: 'block pl-10 text-sm text-muted-foreground md:pl-8 @4xl:hidden',
    groupSpacer: 'hidden @4xl:table-cell',
    groupActions:
      'absolute top-1 right-0 p-0 @4xl:static @4xl:table-cell @4xl:w-12 @4xl:px-2 @4xl:py-2 @4xl:text-right',
  },
  compact: {
    container:
      '@container transition-opacity @2xl:overflow-hidden @2xl:rounded-lg @2xl:border @2xl:bg-card',
    table: 'block @2xl:table',
    header: 'hidden @2xl:table-header-group',
    body: 'block space-y-3 pb-3 @2xl:table-row-group @2xl:space-y-0 @2xl:pb-0',
    card:
      'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-3 rounded-lg border bg-card p-4 ' +
      '@2xl:table-row @2xl:rounded-none @2xl:border-0 @2xl:border-b @2xl:bg-transparent @2xl:p-0',
    nameCell:
      'col-start-1 row-start-1 h-auto min-w-0 p-0 text-left font-normal whitespace-normal @2xl:table-cell @2xl:px-3 @2xl:py-3',
    managersCell: 'hidden p-0 @2xl:table-cell @2xl:w-24 @2xl:px-2 @2xl:py-3',
    buttonsCell:
      'col-span-2 row-start-2 grid grid-cols-2 gap-2 p-0 @2xl:table-cell @2xl:w-28 @2xl:px-1 @2xl:py-3 @2xl:text-right [&>*]:justify-center @2xl:[&>*]:ml-2',
    menuCell:
      'col-start-2 row-start-1 -mt-2 -mr-2 self-start p-0 @2xl:mt-0 @2xl:mr-0 @2xl:table-cell @2xl:w-10 @2xl:px-1 @2xl:py-3 @2xl:text-right',
    cardOnly: '@2xl:hidden',
    shareLabel: '@2xl:sr-only',
    measureCell:
      'hidden px-1 py-3 text-right text-sm tabular-nums @2xl:table-cell @2xl:w-16',
    measureSpan: 'hidden px-1 py-3 text-sm text-muted-foreground @2xl:table-cell',
    measureHead:
      'h-10 px-1 text-right text-xs leading-tight whitespace-normal text-muted-foreground',
    groupRow:
      'relative block border-0 bg-transparent px-1 pt-2 hover:bg-transparent @2xl:table-row @2xl:border-b @2xl:bg-muted/40 @2xl:px-0 @2xl:pt-0 @2xl:hover:bg-muted/40',
    groupName:
      'block h-auto p-0 pr-11 text-left font-normal @2xl:table-cell @2xl:px-3 @2xl:py-2',
    groupSummary: 'block pl-10 text-sm text-muted-foreground md:pl-8 @2xl:hidden',
    groupSpacer: 'hidden @2xl:table-cell',
    groupActions:
      'absolute top-1 right-0 p-0 @2xl:static @2xl:table-cell @2xl:w-10 @2xl:px-1 @2xl:py-2 @2xl:text-right',
  },
}

const DensityContext = createContext<OverviewDensity>('regular')

export const OverviewDensityProvider = DensityContext.Provider

/** The class names the table's parts use at the density the table was given. */
export function useOverviewClasses(): OverviewClasses {
  return OVERVIEW_CLASSES[useContext(DensityContext)]
}
