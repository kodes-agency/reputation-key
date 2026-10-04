// The list table shell: one frame, one header recipe, rows that stack below the
// container's own width. Dark is the default theme; the light variant renders the
// same table on the light surface (axe runs on both). The Storybook Vitest project
// compiles no Tailwind, so these plays pin structure (names, sort state, columns).
// Which width stacks and which tables, and how the frame is drawn, is read in a real
// browser by `e2e/storybook-metrics/data-table.metrics.ts`. The `Narrow` and `Wide`
// stories draw the same table in a 22rem and a 56rem column for that.
import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
  DataTableSortHead,
} from './data-table'
import { RowActionsItem, RowActionsMenu } from './row-actions-menu'

const meta: Meta<typeof DataTable> = {
  title: 'Patterns/Data table',
  component: DataTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof DataTable>

const PEOPLE = [
  { id: 'a', name: 'Anna Petrova', email: 'anna@harborline.example', role: 'Manager' },
  { id: 'b', name: 'Marco Bianchi', email: 'marco@harborline.example', role: 'Staff' },
  { id: 'c', name: 'Iris Okafor', email: 'iris@harborline.example', role: 'Viewer' },
] as const

type Layout = 'rows' | 'cards' | 'scroll'

function People({
  layout = 'rows',
  busy = false,
}: Readonly<{ layout?: Layout; busy?: boolean }>) {
  // Rows start at 3xl; cards at 4xl here, as the Portals overview does.
  const table =
    layout === 'cards'
      ? ({ layout, from: '4xl' } as const)
      : layout === 'scroll'
        ? ({ layout } as const)
        : ({ layout, from: '3xl' } as const)
  return (
    <DataTable label="Members" busy={busy} {...table}>
      <DataTableHeader>
        <DataTableHead>Name</DataTableHead>
        <DataTableHead>Email</DataTableHead>
        <DataTableHead>Role</DataTableHead>
        <DataTableHead actions />
      </DataTableHeader>
      <DataTableBody>
        {PEOPLE.map((person) => (
          <DataTableRow key={person.id}>
            <DataTableCell className="col-start-1 row-start-1 min-w-0 font-medium whitespace-normal">
              {person.name}
            </DataTableCell>
            <DataTableCell className="col-start-1 row-start-2 min-w-0 text-muted-foreground whitespace-normal">
              {person.email}
            </DataTableCell>
            <DataTableCell className="col-start-2 row-start-1 justify-self-end">
              {person.role}
            </DataTableCell>
            <DataTableCell className="col-start-2 row-start-2 justify-self-end @3xl:text-right">
              <RowActionsMenu name={person.name}>
                <RowActionsItem opensDialog destructive>
                  Remove
                </RowActionsItem>
              </RowActionsMenu>
            </DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  )
}

function Column({ width, children }: Readonly<{ width: string; children: ReactNode }>) {
  return <div style={{ width, maxWidth: '100%' }}>{children}</div>
}

/** The table, with its header, as a row of columns; each row names its own cells. */
export const Rows: Story = {
  render: () => (
    <Column width="56rem">
      <People />
    </Column>
  ),
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Members' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4)
    // The actions column is named for a screen reader, and has no word on screen.
    expect(
      within(table).getByRole('columnheader', { name: 'Actions' }),
    ).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(1 + PEOPLE.length)
    // One DOM for every width: a name is in the page once.
    expect(canvas.getAllByText('Anna Petrova')).toHaveLength(1)
  },
}

export const RowsLight: Story = {
  parameters: { theme: 'light' },
  render: Rows.render,
  play: Rows.play,
}

/** A 22rem column: the header row is hidden and each row is a small grid. */
export const Narrow: Story = {
  render: () => (
    <Column width="22rem">
      <People />
    </Column>
  ),
}

/** The same table in a 56rem column: a table with a header row. */
export const Wide: Story = {
  render: () => (
    <Column width="56rem">
      <People />
    </Column>
  ),
}

/** A list whose rows are cards of their own below the width, framed only as a table. */
export const Cards: Story = {
  render: () => (
    <Column width="56rem">
      <People layout="cards" />
    </Column>
  ),
}

export const CardsNarrow: Story = {
  render: () => (
    <Column width="22rem">
      <People layout="cards" />
    </Column>
  ),
}

/** A table that is wide by nature keeps the frame and the header, and scrolls sideways. */
export const Scroll: Story = {
  render: () => (
    <Column width="22rem">
      <People layout="scroll" />
    </Column>
  ),
  play: ({ canvasElement }) => {
    // It is always a table: the header is there at every width.
    expect(
      within(canvasElement).getByRole('columnheader', { name: 'Email' }),
    ).toBeInTheDocument()
  },
}

/** A refetch dims the table and says it is busy; the figures shown are the previous window's. */
export const Busy: Story = {
  render: () => (
    <Column width="56rem">
      <People busy />
    </Column>
  ),
  play: ({ canvasElement }) => {
    const frame = canvasElement.querySelector('[aria-busy="true"]')
    expect(frame).not.toBeNull()
    expect(frame?.className).toContain('opacity-60')
  },
}

type SortKey = 'name' | 'role'

function SortableExample() {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null)
  const direction = (key: SortKey) => (sort?.key === key ? sort.dir : null)
  const choose = (key: SortKey) =>
    setSort((current) =>
      current?.key === key && current.dir === 'asc'
        ? { key, dir: 'desc' }
        : { key, dir: 'asc' },
    )
  return (
    <DataTable label="Sortable members" from="3xl">
      <DataTableHeader>
        <DataTableSortHead direction={direction('name')} onSort={() => choose('name')}>
          Name
        </DataTableSortHead>
        <DataTableSortHead direction={direction('role')} onSort={() => choose('role')}>
          Role
        </DataTableSortHead>
      </DataTableHeader>
      <DataTableBody>
        {PEOPLE.map((person) => (
          <DataTableRow key={person.id}>
            <DataTableCell>{person.name}</DataTableCell>
            <DataTableCell>{person.role}</DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  )
}

/** A header that sorts is a button; the column it orders by says so with `aria-sort`. */
export const Sortable: Story = {
  render: () => (
    <Column width="56rem">
      <SortableExample />
    </Column>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('columnheader', { name: 'Name' })
    const role = canvas.getByRole('columnheader', { name: 'Role' })
    expect(name).not.toHaveAttribute('aria-sort')

    await userEvent.click(within(name).getByRole('button', { name: 'Name' }))
    expect(name).toHaveAttribute('aria-sort', 'ascending')
    expect(role).not.toHaveAttribute('aria-sort')

    await userEvent.click(within(name).getByRole('button', { name: 'Name' }))
    expect(name).toHaveAttribute('aria-sort', 'descending')

    await userEvent.click(within(role).getByRole('button', { name: 'Role' }))
    expect(role).toHaveAttribute('aria-sort', 'ascending')
    expect(name).not.toHaveAttribute('aria-sort')
  },
}
