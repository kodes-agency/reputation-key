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
// `from` is the container width the table starts at: `3xl` or `4xl` for rows, `2xl`
// or `4xl` for cards (each class is written out in full below so Tailwind sees it,
// and only the widths a layout uses are spelled). How a stacked row
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

/** The container widths a list of rows becomes a table at, and a list of cards does. */
export type DataTableRowsFrom = '3xl' | '4xl'
export type DataTableCardsFrom = '2xl' | '4xl'
export type DataTableLayout = 'rows' | 'cards' | 'scroll'

// Only the combinations that are used are written out: every class here is a rule
// in the stylesheet every page loads, so a width no table uses is not spelled.

/** The table and its header row, at each width the shell can start at. */
const SHELL = {
  '2xl': { table: 'block @2xl:table', header: 'hidden @2xl:table-header-group' },
  '3xl': { table: 'block @3xl:table', header: 'hidden @3xl:table-header-group' },
  '4xl': { table: 'block @4xl:table', header: 'hidden @4xl:table-header-group' },
} as const

type Recipe = Readonly<{
  /** The frame, drawn only from the width, for a list of cards. */
  frame: string
  body: string
  row: string
  cell: string
}>

const ROWS = {
  '3xl': {
    frame: '',
    body: 'block @3xl:table-row-group',
    row: '@3xl:table-row @3xl:p-0',
    cell: 'p-0 @3xl:table-cell @3xl:px-4 @3xl:py-3',
  },
  '4xl': {
    frame: '',
    body: 'block @4xl:table-row-group',
    row: '@4xl:table-row @4xl:p-0',
    cell: 'p-0 @4xl:table-cell @4xl:px-4 @4xl:py-3',
  },
} as const satisfies Record<DataTableRowsFrom, Recipe>

// A card keeps its border while it is a card: the last row's divider is dropped only
// when the rows are table rows, where it would double the frame's own edge.
const CARDS = {
  '2xl': {
    frame: '@2xl:overflow-hidden @2xl:rounded-lg @2xl:border @2xl:bg-card',
    body: 'block space-y-3 pb-3 @2xl:table-row-group @2xl:space-y-0 @2xl:pb-0 [&_tr:last-child]:border @2xl:[&_tr:last-child]:border-0',
    row: '@2xl:table-row @2xl:rounded-none @2xl:border-0 @2xl:border-b @2xl:bg-transparent @2xl:p-0',
    cell: '',
  },
  '4xl': {
    frame: '@4xl:overflow-hidden @4xl:rounded-lg @4xl:border @4xl:bg-card',
    body: 'block space-y-3 pb-3 @4xl:table-row-group @4xl:space-y-0 @4xl:pb-0 [&_tr:last-child]:border @4xl:[&_tr:last-child]:border-0',
    row: '@4xl:table-row @4xl:rounded-none @4xl:border-0 @4xl:border-b @4xl:bg-transparent @4xl:p-0',
    cell: '',
  },
} as const satisfies Record<DataTableCardsFrom, Recipe>

/** A table that scrolls is always a table: nothing stacks, so nothing is conditional. */
const SCROLL = {
  frame: '',
  body: '',
  row: '',
  cell: 'px-4 py-3',
} as const satisfies Recipe

/** The stacked grid: a flexible first column, then the rest as wide as they are. */
const TRACKS = {
  2: 'grid-cols-[minmax(0,1fr)_auto]',
  3: 'grid-cols-[minmax(0,1fr)_auto_auto]',
} as const

/** What the parts of one table read: resolved once by the table, so no part chooses. */
type Shell = Readonly<{
  layout: DataTableLayout
  table: string
  header: string
  recipe: Recipe
}>

const ShellContext = createContext<Shell>({
  layout: 'rows',
  ...SHELL['4xl'],
  recipe: ROWS['4xl'],
})

function resolveShell(layout: DataTableLayout, from: keyof typeof SHELL): Shell {
  if (layout === 'scroll') return { layout, table: '', header: '', recipe: SCROLL }
  // The props allow only the widths each layout has a recipe for.
  const recipe =
    layout === 'cards'
      ? CARDS[from as DataTableCardsFrom]
      : ROWS[from as DataTableRowsFrom]
  return { layout, ...SHELL[from], recipe }
}

type CommonProps = Readonly<{
  /** Names the table for a screen reader: "Properties", "Members". */
  label: string
  /** A new window of data is loading and the figures shown are the previous one's. */
  busy?: boolean
  children: ReactNode
}>

type DataTableProps = CommonProps &
  (
    | Readonly<{ layout?: 'rows'; from?: DataTableRowsFrom }>
    | Readonly<{ layout: 'cards'; from?: DataTableCardsFrom }>
    | Readonly<{ layout: 'scroll'; from?: undefined }>
  )

export function DataTable({
  label,
  from = '4xl',
  layout = 'rows',
  busy = false,
  children,
}: DataTableProps) {
  const shell = resolveShell(layout, from)
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
          layout === 'cards'
            ? shell.recipe.frame
            : 'overflow-hidden rounded-lg border bg-card'
        }
      >
        <Table aria-label={label} className={shell.table || undefined}>
          <ShellContext value={shell}>{children}</ShellContext>
        </Table>
      </div>
    </div>
  )
}

/** The header row: not shown while the rows are stacked. */
export function DataTableHeader({ children }: Readonly<{ children?: ReactNode }>) {
  const { header } = use(ShellContext)
  return (
    <TableHeader className={header || undefined}>
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
  const { recipe } = use(ShellContext)
  return <TableBody className={cn(recipe.body, className)} {...props} />
}

type RowProps = ComponentProps<typeof TableRow> &
  Readonly<{
    /** How many columns the stacked grid has. Not used by a table that scrolls. */
    tracks?: keyof typeof TRACKS
  }>

/** A row: a small grid while stacked (a card, in a list of cards), a table row from the width. */
export function DataTableRow({ tracks = 2, className, ...props }: RowProps) {
  const { layout, recipe } = use(ShellContext)
  const stacked =
    layout === 'scroll'
      ? undefined
      : layout === 'cards'
        ? cn('grid gap-x-2 gap-y-3 rounded-lg border bg-card p-4', TRACKS[2], recipe.row)
        : cn(
            'grid gap-x-3 gap-y-1.5 px-4 py-3.5 hover:bg-muted/40',
            TRACKS[tracks],
            recipe.row,
          )
  return <TableRow className={cn(stacked, className)} {...props} />
}

/**
 * A cell: bare while stacked (the row's grid places it), padded as a table cell from
 * the width. In a list of cards the cells are the caller's, which sets each one's
 * padding for its density.
 */
export function DataTableCell({ className, ...props }: ComponentProps<typeof TableCell>) {
  const { recipe } = use(ShellContext)
  return <TableCell className={cn(recipe.cell, className)} {...props} />
}
