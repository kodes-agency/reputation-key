// The list table shell (UI consistency scan: COLL-03). Extracted from the
// Properties list table, which `ui/table` was used raw around in thirteen files
// with seven frames, four header recipes and four ways to degrade on a phone.
//
// One DOM for every width, so a row's name renders once (the e2e journeys and
// Storybook, which compile no container queries, both lean on that). Below a
// container width each row stacks as a small grid and the header row is not shown;
// from it the same markup is a table. The container is the frame's own, not the
// window, so an open sidebar or a narrow column counts.
//
// - `layout="rows"` (the default): the frame is always drawn and the stacked rows
//   are divided inside it. Properties, Members, Staff.
// - `layout="cards"`: below the width each row is a card of its own and the frame
//   only appears with the table. The Portals tables, whose rows are cards with
//   buttons.
// - `layout="scroll"`: always a table, framed, scrolling sideways when it is wider
//   than its column. For a table that is wide by nature (a matrix, seven columns).
//
// `from` is the container width the table starts at (`2xl`, `3xl` or `4xl`; each
// class is written out in full below so Tailwind sees it). How a stacked row
// arranges its cells is the caller's: `tracks` says how many columns the stacked
// grid has, and a cell places itself with `col-start-*` / `row-start-*`.
import { createContext, use, type ComponentProps, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { cn } from '#/lib/utils'

export type DataTableFrom = '2xl' | '3xl' | '4xl'
export type DataTableLayout = 'rows' | 'cards' | 'scroll'

type Recipe = Readonly<{
  /** The frame, drawn only from the width, for a list of cards. */
  frame: string
  table: string
  header: string
  rowsBody: string
  cardsBody: string
  rowsRow: string
  cardsRow: string
  cell: string
}>

const RECIPE = {
  '2xl': {
    frame: '@2xl:overflow-hidden @2xl:rounded-lg @2xl:border @2xl:bg-card',
    table: 'block @2xl:table',
    header: 'hidden @2xl:table-header-group',
    rowsBody: 'block @2xl:table-row-group',
    cardsBody: 'block space-y-3 pb-3 @2xl:table-row-group @2xl:space-y-0 @2xl:pb-0',
    rowsRow: '@2xl:table-row @2xl:p-0',
    cardsRow:
      '@2xl:table-row @2xl:rounded-none @2xl:border-0 @2xl:border-b @2xl:bg-transparent @2xl:p-0',
    cell: '@2xl:table-cell @2xl:px-4 @2xl:py-3',
  },
  '3xl': {
    frame: '@3xl:overflow-hidden @3xl:rounded-lg @3xl:border @3xl:bg-card',
    table: 'block @3xl:table',
    header: 'hidden @3xl:table-header-group',
    rowsBody: 'block @3xl:table-row-group',
    cardsBody: 'block space-y-3 pb-3 @3xl:table-row-group @3xl:space-y-0 @3xl:pb-0',
    rowsRow: '@3xl:table-row @3xl:p-0',
    cardsRow:
      '@3xl:table-row @3xl:rounded-none @3xl:border-0 @3xl:border-b @3xl:bg-transparent @3xl:p-0',
    cell: '@3xl:table-cell @3xl:px-4 @3xl:py-3',
  },
  '4xl': {
    frame: '@4xl:overflow-hidden @4xl:rounded-lg @4xl:border @4xl:bg-card',
    table: 'block @4xl:table',
    header: 'hidden @4xl:table-header-group',
    rowsBody: 'block @4xl:table-row-group',
    cardsBody: 'block space-y-3 pb-3 @4xl:table-row-group @4xl:space-y-0 @4xl:pb-0',
    rowsRow: '@4xl:table-row @4xl:p-0',
    cardsRow:
      '@4xl:table-row @4xl:rounded-none @4xl:border-0 @4xl:border-b @4xl:bg-transparent @4xl:p-0',
    cell: '@4xl:table-cell @4xl:px-4 @4xl:py-3',
  },
} as const satisfies Record<DataTableFrom, Recipe>

/** The stacked grid: a flexible first column, then the rest as wide as they are. */
const TRACKS = {
  2: 'grid-cols-[minmax(0,1fr)_auto]',
  3: 'grid-cols-[minmax(0,1fr)_auto_auto]',
} as const

type Shell = Readonly<{ from: DataTableFrom; layout: DataTableLayout }>

const ShellContext = createContext<Shell>({ from: '4xl', layout: 'rows' })

type DataTableProps = Readonly<{
  /** Names the table for a screen reader: "Properties", "Members". */
  label: string
  from?: DataTableFrom
  layout?: DataTableLayout
  /** A new window of data is loading and the figures shown are the previous one's. */
  busy?: boolean
  children: ReactNode
}>

export function DataTable({
  label,
  from = '4xl',
  layout = 'rows',
  busy = false,
  children,
}: DataTableProps) {
  const recipe = RECIPE[from]
  return (
    // The container and the frame are two elements: a container cannot be queried
    // by its own classes, so a frame that appears from a width is drawn by the
    // element inside the one that measures it.
    <div
      aria-busy={busy || undefined}
      className={cn('@container', busy && 'opacity-60 transition-opacity')}
    >
      <div
        className={
          layout === 'cards' ? recipe.frame : 'overflow-hidden rounded-lg border bg-card'
        }
      >
        <Table
          aria-label={label}
          className={layout === 'scroll' ? undefined : recipe.table}
        >
          <ShellContext value={{ from, layout }}>{children}</ShellContext>
        </Table>
      </div>
    </div>
  )
}

/** The header row: not shown while the rows are stacked. */
export function DataTableHeader({ children }: Readonly<{ children?: ReactNode }>) {
  const { from, layout } = use(ShellContext)
  return (
    <TableHeader className={layout === 'scroll' ? undefined : RECIPE[from].header}>
      <TableRow className="hover:bg-transparent">{children}</TableRow>
    </TableHeader>
  )
}

type HeadProps = Omit<ComponentProps<typeof TableHead>, 'scope' | 'align'> &
  Readonly<{
    align?: 'start' | 'end'
    /** The column of row actions: named "Actions" for a screen reader, with no word on screen. */
    actions?: boolean
  }>

const HEAD = 'h-10 px-4 text-xs text-muted-foreground'

/** A header cell: the one quiet recipe. */
export function DataTableHead({
  align = 'start',
  actions = false,
  className,
  children,
  ...props
}: HeadProps) {
  return (
    <TableHead
      scope="col"
      className={cn(HEAD, align === 'end' && 'text-right', actions && 'px-2', className)}
      {...props}
    >
      {actions ? <span className="sr-only">Actions</span> : children}
    </TableHead>
  )
}

type SortHeadProps = Readonly<{
  /** The direction this column is ordered in, or null when another column is. */
  direction: 'asc' | 'desc' | null
  onSort: () => void
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}>

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown } as const
const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const

/** A header cell that is a button ordering the table by its column. */
export function DataTableSortHead({
  direction,
  onSort,
  align = 'start',
  className,
  children,
}: SortHeadProps) {
  const Icon = direction === null ? ArrowUpDown : SORT_ICON[direction]
  return (
    <TableHead
      scope="col"
      aria-sort={direction === null ? undefined : ARIA_SORT[direction]}
      className={cn('h-10 px-4', align === 'end' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          '-mx-1 inline-flex h-8 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-ring',
          direction !== null && 'text-foreground',
          align === 'end' && 'flex-row-reverse',
        )}
      >
        {children}
        <Icon
          className={cn('size-3.5', direction === null && 'opacity-40')}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  )
}

/** One `<tbody>`; a list of cards spaces its cards, and a table of sections has several. */
export function DataTableBody({ className, ...props }: ComponentProps<typeof TableBody>) {
  const { from, layout } = use(ShellContext)
  const recipe = RECIPE[from]
  const base =
    layout === 'scroll'
      ? undefined
      : layout === 'cards'
        ? recipe.cardsBody
        : recipe.rowsBody
  return <TableBody className={cn(base, className)} {...props} />
}

type RowProps = ComponentProps<typeof TableRow> &
  Readonly<{
    /** How many columns the stacked grid has. Not used by a table that scrolls. */
    tracks?: keyof typeof TRACKS
  }>

/** A row: a small grid while stacked (a card, in a list of cards), a table row from the width. */
export function DataTableRow({ tracks = 2, className, ...props }: RowProps) {
  const { from, layout } = use(ShellContext)
  const recipe = RECIPE[from]
  const stacked =
    layout === 'scroll'
      ? undefined
      : layout === 'cards'
        ? cn(
            'grid gap-x-2 gap-y-3 rounded-lg border bg-card p-4',
            TRACKS[2],
            recipe.cardsRow,
          )
        : cn(
            'grid gap-x-3 gap-y-1.5 px-4 py-3.5 hover:bg-muted/40',
            TRACKS[tracks],
            recipe.rowsRow,
          )
  return <TableRow className={cn(stacked, className)} {...props} />
}

/** A cell: bare while stacked (the row's grid places it), padded as a table cell from the width. */
export function DataTableCell({ className, ...props }: ComponentProps<typeof TableCell>) {
  const { from, layout } = use(ShellContext)
  return (
    <TableCell
      className={cn(
        layout === 'scroll' ? 'px-4 py-3' : `p-0 ${RECIPE[from].cell}`,
        className,
      )}
      {...props}
    />
  )
}
