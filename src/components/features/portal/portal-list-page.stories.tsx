import type { Meta, StoryObj } from '@storybook/react'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import { overviewRow } from './portal-overview/portal-overview-fixtures'
import { MAX_SEARCH_LENGTH } from './portal-overview/portal-overview-search-schema'
import {
  ControlledPage,
  baseArgs,
  newPortalData,
  rows,
} from './portal-list-page-stories-data'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof ControlledPage> = {
  title: 'Portal/PortalListPage',
  component: ControlledPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof ControlledPage>

export const Default: Story = { args: baseArgs }

// "New portal" opens the dialog over the list (the page keeps it in the URL);
// Cancel closes it again.
export const OpensTheNewPortalDialog: Story = {
  args: { ...baseArgs, newPortal: { data: newPortalData } },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'New portal' }),
    )
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.getByRole('heading', { name: 'New portal' })).toBeInTheDocument()
    await expect(dialog.getByText('No one will be responsible yet')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
}

export const Empty: Story = {
  args: { ...baseArgs, rows: [], portalGroups: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/no portals yet/i)).toBeInTheDocument()
  },
}

export const GroupedWithCounts: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The group editor below the table repeats the group names, so look inside the table.
    const table = within(canvas.getByRole('table', { name: /portals at avela resort/i }))
    await expect(table.getByText('Pool side')).toBeInTheDocument()
    await expect(table.getByText(/3 portals/)).toBeInTheDocument()
    await expect(table.getByText('Front of house')).toBeInTheDocument()
    await expect(table.getByText('Not in a group')).toBeInTheDocument()
    await expect(canvas.getByText('6 portals at Avela Resort')).toBeInTheDocument()
  },
}

export const ShowsPortalNames: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of rows.map((row) => row.name)) {
      await expect(canvas.getByRole('link', { name })).toBeInTheDocument()
    }
  },
}

export const ListsTheCodeAndLanguagesNeverAPlace: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('QR and NFC').length).toBeGreaterThan(0)
    await expect(canvas.getByText('No code yet')).toBeInTheDocument()
    await expect(
      canvas.getByText('Languages: English, Bulgarian, Spanish, German'),
    ).toBeInTheDocument()
  },
}

// Status only by exception: the quiet line appears on the portals that need
// something, and on no others.
export const StatusOnlyByException: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2 changes not live')).toBeInTheDocument()
    await expect(canvas.getByText(/draft · not published/i)).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /1 issue/i })).toBeInTheDocument()
    await expect(canvas.queryByText(/live ·/i)).toBeNull()
    await expect(canvas.queryByText('Published')).toBeNull()
  },
}

export const IssuesSaySpecifically: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /1 issue/i }))
    const dialog = await within(document.body).findByRole('dialog')
    await expect(within(dialog).getByText('No one is responsible')).toBeInTheDocument()
    await expect(within(dialog).queryByText(/reprint/i)).toBeNull()
  },
}

export const ResponsibleManagers: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getAllByText('Responsible: Georgi Ivanov and Elena Petrova'),
    ).toHaveLength(2)
    await expect(canvas.getByText('No one')).toBeInTheDocument()
  },
}

export const FoldsAGroup: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Portals in Pool side' }))
    await expect(canvas.queryByRole('link', { name: 'Pool & Terrace' })).toBeNull()
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Portals in Pool side' }))
    await expect(canvas.getByRole('link', { name: 'Pool & Terrace' })).toBeInTheDocument()
  },
}

export const RowMenuHoldsTheRest: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', {
        name: 'More actions for Pool & Terrace',
      }),
    )
    const menu = await within(document.body).findByRole('menu')
    await expect(
      within(menu).getByRole('menuitem', { name: 'Results' }),
    ).toBeInTheDocument()
    await expect(
      within(menu).getByRole('menuitem', { name: 'History' }),
    ).toBeInTheDocument()
    await expect(
      within(menu).getByRole('menuitem', { name: 'Review & publish' }),
    ).toBeInTheDocument()
    await expect(
      within(menu).getByRole('menuitem', { name: /archive/i }),
    ).toBeInTheDocument()
  },
}

export const RecoverableLifecycle: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Reception' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: /archive/i }),
    )
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /archive reception/i,
      }),
    ).toBeInTheDocument()
    await userEvent.click(within(document.body).getByRole('button', { name: /cancel/i }))
  },
}

export const ArchivedCanBeRestored: Story = {
  args: {
    ...baseArgs,
    rows: [
      overviewRow('p-old', { name: 'Archived Lobby', publicationState: 'archived' }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Archived')).toBeInTheDocument()
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Archived Lobby' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: /restore/i }),
    )
    await expect(
      await within(document.body).findByRole('alertdialog', {
        name: /restore archived lobby/i,
      }),
    ).toBeInTheDocument()
    await expect(
      within(document.body).getByText(/return as disabled/i),
    ).toBeInTheDocument()
  },
}

export const SearchFiltersRows: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/search portals/i), 'spa')
    await expect(
      canvas.getByRole('link', { name: 'Spa & thermal pools' }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: 'Reception' })).toBeNull()
    await expect(canvas.getByText(/1 of 3 portals/)).toBeInTheDocument()
  },
}

export const SearchWithNoMatches: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/search portals/i), 'zzzz')
    await expect(canvas.getByText(/no portals match/i)).toBeInTheDocument()
    await userEvent.click(
      canvas.getByRole('button', { name: /clear search and filter/i }),
    )
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
  },
}

export const NeedsAttentionFilter: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /show: all/i }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', {
        name: 'Needs attention',
      }),
    )
    await waitFor(() =>
      expect(canvas.queryByRole('link', { name: 'Reception' })).toBeNull(),
    )
    await expect(canvas.getByRole('link', { name: 'Pool bar' })).toBeInTheDocument()
  },
}

export const FlatList: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /group by: group/i }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', { name: 'Nothing' }),
    )
    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: /portals in/i })).toBeNull(),
    )
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
  },
}

const manyRows = Array.from({ length: 25 }, (_, index) =>
  overviewRow(`p-${String(index + 1).padStart(2, '0')}`, {
    name: `Room ${String(index + 1).padStart(2, '0')}`,
  }),
)

export const PagesLongLists: Story = {
  args: { ...baseArgs, rows: manyRows, portalGroups: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Showing 1–20 of 25')).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: 'Room 25' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
    await expect(canvas.getByText('Showing 21–25 of 25')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Room 25' })).toBeInTheDocument()
  },
}

export const Phone: Story = {
  args: baseArgs,
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Pool & Terrace' })).toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: 'Edit Pool & Terrace' }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: 'Share Pool & Terrace' }),
    ).toBeInTheDocument()
  },
}

export const SearchStopsAtItsLimit: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('searchbox', { name: 'Search portals' })
    await userEvent.click(box)
    await userEvent.paste('a'.repeat(MAX_SEARCH_LENGTH + 20))
    await expect(box).toHaveValue('a'.repeat(MAX_SEARCH_LENGTH))
  },
}

export const MemberReadOnly: Story = {
  args: baseArgs,
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('link', { name: /new portal/i })).toBeNull()
    await expect(canvas.queryByRole('link', { name: /^edit /i })).toBeNull()
    await expect(
      canvas.getByRole('link', { name: 'View Pool & Terrace' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/view-only access/i)).toBeInTheDocument()
  },
}
