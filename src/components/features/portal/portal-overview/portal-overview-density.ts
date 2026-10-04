// How tightly the Portals table sets itself. The overview has the page's whole
// width and becomes a table from a 56 rem container (`@4xl`); a group's page
// gives its table the left column beside the goal and history (board 13), about
// 46 rem on a laptop, so it becomes a table from 42 rem (`@2xl`) with narrower
// columns and an icon for Share. One DOM for both: only the class names differ.
//
// The frame, the table, its header and its bodies are the shared `DataTable`
// (`layout="cards"`), which takes the container width from `OVERVIEW_FROM`. Every
// class here is written out in full (never assembled), so Tailwind sees each one.
// A table that is narrower than its breakpoint is a stack of cards in either density.
import { createContext, useContext } from 'react'
import type { DataTableCardsFrom } from '#/components/ui/data-table'

export type OverviewDensity = 'regular' | 'compact'

/** The container width each density becomes a table at: 56 rem, and 42 rem. */
export const OVERVIEW_FROM: Readonly<Record<OverviewDensity, DataTableCardsFrom>> = {
  regular: '4xl',
  compact: '2xl',
}

export type OverviewClasses = Readonly<{
  /** The Portal's name cell and the Portal's cells that follow it. */
  nameCell: string
  managersCell: string
  /** Edit and Share; aligned by their middles, as Share starts with an icon and Edit with text. */
  buttonsCell: string
  menuCell: string
  /** Shown as a card only: the one summary line, and the pencil on Edit. */
  cardOnly: string
  /** The words of Share: beside its icon in the regular table, only for a screen reader in the compact one. */
  shareLabel: string
  /** Where Share is not offered (a draft, an archived Portal), the unseen box that keeps Edit in its column; a card has no column to keep. */
  sharePlaceholder: string
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
    nameCell:
      'col-start-1 row-start-1 h-auto min-w-0 p-0 text-left font-normal whitespace-normal @4xl:table-cell @4xl:px-4 @4xl:py-3',
    managersCell: 'hidden p-0 @4xl:table-cell @4xl:w-36 @4xl:px-4 @4xl:py-3',
    buttonsCell:
      'col-span-2 row-start-2 grid grid-cols-2 gap-2 p-0 @4xl:table-cell @4xl:w-48 @4xl:px-2 @4xl:py-3 @4xl:text-right [&>*]:justify-center @4xl:[&>*]:ml-2 @4xl:[&>*]:align-middle',
    menuCell:
      'col-start-2 row-start-1 -mt-2 -mr-2 self-start p-0 @4xl:mt-0 @4xl:mr-0 @4xl:table-cell @4xl:w-12 @4xl:px-2 @4xl:py-3 @4xl:text-right',
    cardOnly: '@4xl:hidden',
    shareLabel: '',
    sharePlaceholder: 'hidden @4xl:inline-flex',
    measureCell:
      'hidden px-2 py-3 text-right text-sm tabular-nums @4xl:table-cell @4xl:w-24',
    measureSpan: 'hidden px-2 py-3 text-sm text-muted-foreground @4xl:table-cell',
    measureHead: 'px-2 leading-tight whitespace-normal',
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
    nameCell:
      'col-start-1 row-start-1 h-auto min-w-0 p-0 text-left font-normal whitespace-normal @2xl:table-cell @2xl:px-3 @2xl:py-3',
    managersCell: 'hidden p-0 @2xl:table-cell @2xl:w-24 @2xl:px-2 @2xl:py-3',
    buttonsCell:
      'col-span-2 row-start-2 grid grid-cols-2 gap-2 p-0 @2xl:table-cell @2xl:w-28 @2xl:px-1 @2xl:py-3 @2xl:text-right [&>*]:justify-center @2xl:[&>*]:ml-2 @2xl:[&>*]:align-middle',
    menuCell:
      'col-start-2 row-start-1 -mt-2 -mr-2 self-start p-0 @2xl:mt-0 @2xl:mr-0 @2xl:table-cell @2xl:w-10 @2xl:px-1 @2xl:py-3 @2xl:text-right',
    cardOnly: '@2xl:hidden',
    shareLabel: '@2xl:sr-only',
    sharePlaceholder: 'hidden @2xl:inline-flex',
    measureCell:
      'hidden px-1 py-3 text-right text-sm tabular-nums @2xl:table-cell @2xl:w-16',
    measureSpan: 'hidden px-1 py-3 text-sm text-muted-foreground @2xl:table-cell',
    measureHead: 'px-1 leading-tight whitespace-normal',
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
