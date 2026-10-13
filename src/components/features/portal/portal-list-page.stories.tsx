import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  NO_CODE,
  OLDER_CODE,
  overviewGroup,
  overviewRow,
} from './portal-overview/portal-overview-fixtures'
import { PortalWritesOffDecorator } from './portal-overview/portal-writes-off-decorator'
import { MAX_LIST_SEARCH_LENGTH } from '#/components/property/list-search-limit'
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

export const Default: Story = {
  args: baseArgs,
  // The Property look is one click from the list, as board 1 draws it.
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('link', { name: 'Property look' }),
    ).toHaveAttribute('href', '/properties/prop-1/portals/look')
  },
}

/**
 * The header's New portal. The phone's bottom bar repeats it (board 11) and CSS
 * decides which one shows; story tests run without CSS, so both are in the tree,
 * the header's first.
 */
function headerNewPortalButton(canvasElement: HTMLElement): HTMLElement {
  const [header, phone] = within(canvasElement).getAllByRole('button', {
    name: 'New portal',
  })
  if (header === undefined || phone?.closest('.sm\\:hidden') == null) {
    throw new Error('expected New portal in the header and in the phone bar')
  }
  return header
}

// "New portal" opens the dialog over the list (the page keeps it in the URL);
// Cancel closes it again.
export const OpensTheNewPortalDialog: Story = {
  args: { ...baseArgs, newPortal: { data: newPortalData } },
  play: async ({ canvasElement }) => {
    await userEvent.click(headerNewPortalButton(canvasElement))
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.getByRole('heading', { name: 'New portal' })).toBeInTheDocument()
    await expect(dialog.getByText('No one will be responsible yet')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
}

export const Empty: Story = {
  args: { ...baseArgs, rows: [], groups: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/no portals yet/i)).toBeInTheDocument()
    // The one time every new customer sees this, it says what the product is for.
    await expect(
      within(canvasElement).getByText(/rate their visit, leave you a private note/),
    ).toBeInTheDocument()
  },
}

// A group's head links to its page and carries its actions; the ungrouped head
// is no group, so it has neither.
export const GroupHeadsLinkToTheirPageAndCarryActions: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Pool side' })).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Front of house' })).toBeInTheDocument()
    await expect(
      canvas.getByRole('button', { name: 'More actions for group Pool side' }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: 'Not in a group' })).toBeNull()
    await expect(
      canvas.queryByRole('button', { name: /actions for group not in/i }),
    ).toBeNull()
  },
}

// A group made first, or emptied, has no portal to show it by: its head stays
// so its page can still be opened.
export const AGroupWithNoPortalStaysReachable: Story = {
  args: {
    ...baseArgs,
    groups: [...baseArgs.groups, overviewGroup('group-quiet', 'Quiet corner')],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Quiet corner' })).toBeInTheDocument()
    await expect(canvas.getByText(/· 0 portals/)).toBeInTheDocument()
  },
}

export const NewGroupOpensTheDialog: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'New group' }),
    )
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.getByRole('heading', { name: 'New group' })).toBeInTheDocument()
    await expect(
      dialog.getByRole('checkbox', { name: /pool & terrace/i }),
    ).toBeInTheDocument()
  },
}

export const GroupedWithCounts: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
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
    await expect(canvas.getByText(/2 changes not live/)).toBeInTheDocument()
    await expect(canvas.getByText(/draft · not published/i)).toBeInTheDocument()
    // A single issue is named in the row, not counted: "No one responsible", not "1 issue".
    await expect(
      canvas.getByRole('link', { name: /no one responsible/i }),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/1 issue/i)).toBeNull()
    await expect(canvas.queryByText(/^live ·/i)).toBeNull()
    await expect(canvas.queryByText('Published')).toBeNull()
  },
}

// A code issued before access artifacts works, but its scans are not counted: one
// line, which leads to Share where the code is replaced. Not an "issue".
export const OlderCodeLinksToShare: Story = {
  args: {
    ...baseArgs,
    rows: [...rows, overviewRow('p-gym', { name: 'Gym', token: OLDER_CODE })],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByRole('link', { name: /scans not counted/i })
    const href = new URL(line.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe('/properties/prop-1/portals/p-gym')
    await expect(href.searchParams.get('tab')).toBe('share')
    // It says what puts it right and what that costs, not only that something is missing.
    await expect(line).toHaveTextContent(/replace the code \(needs reprinting\)/)
    // Gym's own row carries it; no other Portal does.
    await expect(canvas.getAllByText(/scans not counted/i)).toHaveLength(1)
  },
}

// One issue is named in the row, in the words of the issue, and is the way to its
// fix: no popover to open first.
export const ASingleIssueIsNamedAndLinksToItsFix: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', {
      name: /no one responsible/i,
    })
    await expect(link).toHaveTextContent('No one responsible')
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe('/properties/prop-1/portals/p-spa')
    await expect(href.searchParams.get('tab')).toBe('page')
    await expect(href.searchParams.get('section')).toBe('responsible')
    // Not a count, and no popover to open.
    await expect(
      within(canvasElement).queryByRole('button', { name: /issue/i }),
    ).toBeNull()
  },
}

// A Portal guests cannot reach says so in the row, and in red: it does not look
// like a missing manager.
export const ABlockingIssueIsRedAndWorded: Story = {
  args: {
    ...baseArgs,
    rows: [...rows, overviewRow('p-gym', { name: 'Gym', token: NO_CODE })],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const blocking = canvas.getByRole('link', { name: /gym: no working code/i })
    await expect(blocking).toHaveTextContent('No working code')
    await expect(blocking.className).toContain('text-negative')
    const href = new URL(blocking.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.searchParams.get('tab')).toBe('share')
    // The missing manager is the lesser problem, and wears the lesser colour.
    const notice = canvas.getByRole('link', { name: /spa & thermal pools: no one/i })
    await expect(notice.className).toContain('text-warn')
  },
}

// Two or more are counted, and a popover says which and where to put each right.
export const SeveralIssuesOpenAPopover: Story = {
  args: {
    ...baseArgs,
    rows: [
      ...rows,
      overviewRow('p-gym', {
        name: 'Gym',
        token: NO_CODE,
        responsibleManagerUserIds: [],
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: /gym: 2 issues/i }),
    )
    const dialog = await within(document.body).findByRole('dialog')
    await expect(within(dialog).getByText('No working code')).toBeInTheDocument()
    await expect(within(dialog).getByText('No one is responsible')).toBeInTheDocument()
    await expect(within(dialog).getByRole('link', { name: 'Open Share' })).toBeVisible()
    await expect(
      within(dialog).getByRole('link', { name: 'Choose a manager' }),
    ).toBeVisible()
    await expect(within(dialog).queryByText(/reprint/i)).toBeNull()
  },
}

// Changes waiting to go live lead to where they are published, for whoever may publish.
export const PendingChangesLeadToReviewAndPublish: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', {
      name: 'Review and publish Pool & Terrace',
    })
    await expect(link).toHaveTextContent('Review & publish')
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost')
    await expect(href.pathname).toBe('/properties/prop-1/portals/p-terrace/review')
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

const disableSpy = fn(
  async (_input: { data: { portalId: string; publicationState: 'disabled' } }) =>
    undefined,
)

/** A live page is taken down from the row's menu, after a confirmation. */
export const DisablesALivePage: Story = {
  args: {
    ...baseArgs,
    disableMutation: Object.assign(disableSpy, {
      isPending: false,
      error: null,
      isSuccess: false,
      data: null,
    }),
  },
  play: async ({ canvasElement }) => {
    disableSpy.mockClear()
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Reception' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: 'Disable public page…',
      }),
    )
    const dialog = within(
      await within(document.body).findByRole('alertdialog', {
        name: 'Disable the public page of Reception?',
      }),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Disable public page' }))
    await waitFor(() =>
      expect(disableSpy).toHaveBeenCalledWith({
        data: { portalId: 'p-reception', publicationState: 'disabled' },
      }),
    )
  },
}

/** Cancel leaves the page live: nothing is written. */
export const DisableCanBeCancelled: Story = {
  args: {
    ...baseArgs,
    disableMutation: Object.assign(disableSpy, {
      isPending: false,
      error: null,
      isSuccess: false,
      data: null,
    }),
  },
  play: async ({ canvasElement }) => {
    disableSpy.mockClear()
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Reception' }),
    )
    await userEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: 'Disable public page…',
      }),
    )
    const dialog = await within(document.body).findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await expect(disableSpy).not.toHaveBeenCalled()
  },
}

/** A draft has nothing live to take down. */
export const DraftOffersNoDisable: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for Pool bar' }),
    )
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(
      menu.queryByRole('menuitem', { name: /disable public page/i }),
    ).toBeNull()
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
    const panel = within(
      canvasElement.querySelector<HTMLElement>('[data-slot="empty-state"]')!,
    )
    await userEvent.click(panel.getByRole('button', { name: 'Clear search and filters' }))
    await expect(canvas.getByRole('link', { name: 'Reception' })).toBeInTheDocument()
  },
}

export const NeedsAttentionFilter: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: /needs attention/i })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    await waitFor(() =>
      expect(canvas.queryByRole('link', { name: 'Reception' })).toBeNull(),
    )
    await expect(canvas.getByRole('link', { name: 'Pool bar' })).toBeInTheDocument()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // A second press shows every Portal again.
    await userEvent.click(toggle)
    await expect(
      await canvas.findByRole('link', { name: 'Reception' }),
    ).toBeInTheDocument()
  },
}

export const FlatList: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /group by: portal group/i }))
    await userEvent.click(
      await within(document.body).findByRole('menuitemradio', { name: 'None' }),
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
  args: { ...baseArgs, rows: manyRows, groups: [] },
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
    await userEvent.paste('a'.repeat(MAX_LIST_SEARCH_LENGTH + 20))
    await expect(box).toHaveValue('a'.repeat(MAX_LIST_SEARCH_LENGTH))
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
    // A member can change no group: no way to make one, and a head's menu only opens it.
    await expect(canvas.queryByRole('button', { name: /new group/i })).toBeNull()
    await userEvent.click(
      canvas.getAllByRole('button', { name: /actions for group pool side/i })[0]!,
    )
    const menu = within(await screen.findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: 'Open group' })).toBeInTheDocument()
    await expect(menu.queryByRole('menuitem', { name: /rename/i })).toBeNull()
    await expect(menu.queryByRole('menuitem', { name: /archive/i })).toBeNull()
  },
}

const ungrouped = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    overviewRow(`p-flat-${index + 1}`, { name: `Room ${index + 1}` }),
  )

// One Property, a few portals and no group is the common customer: the list is
// the list. No group head, no Group by, no search, no sort, no "Showing 1–3 of 3".
export const AShortListWithNoGroupsIsJustTheList: Story = {
  args: { ...baseArgs, rows: ungrouped(3), groups: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Room 1' })).toBeInTheDocument()
    await expect(canvas.queryByText(/not in a group/i)).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^portals in /i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /group by/i })).toBeNull()
    await expect(canvas.queryByRole('searchbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: /sort/i })).toBeNull()
    await expect(canvas.queryByText(/showing/i)).toBeNull()
    // The way into groups stays where it was.
    await expect(canvas.getByRole('button', { name: 'New group' })).toBeInTheDocument()
  },
}

// A longer list earns its search and sort, still with no group to head.
export const ALongListWithNoGroupsKeepsSearchAndSort: Story = {
  args: { ...baseArgs, rows: ungrouped(7), groups: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('searchbox', { name: 'Search portals' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /sort: name/i })).toBeVisible()
    await expect(canvas.getByText('Showing 1–7 of 7')).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /group by/i })).toBeNull()
    await expect(canvas.queryByText(/not in a group/i)).toBeNull()
  },
}

// The first group brings the heads and Group by with it, even on a short list.
export const TheFirstGroupBringsGroupBy: Story = {
  args: {
    ...baseArgs,
    rows: [
      overviewRow('p-a', { name: 'Room A', group: overviewGroup('g-1', 'Wing') }),
      overviewRow('p-b', { name: 'Room B' }),
    ],
    groups: [overviewGroup('g-1', 'Wing')],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Wing' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /group by/i })).toBeInTheDocument()
    // Short, so still no search or sort.
    await expect(canvas.queryByRole('searchbox')).toBeNull()
  },
}

// A phone has no room for two secondary buttons above the first portal: they are
// one menu beside the title (the desktop buttons are in the tree too, as story
// tests compile no CSS to hide either).
export const HeaderActionsAreOneMenuOnAPhone: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'More actions for portals' }),
    )
    const menu = within(await screen.findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: 'Property look' })).toHaveAttribute(
      'href',
      '/properties/prop-1/portals/look',
    )
    await userEvent.click(menu.getByRole('menuitem', { name: 'New group…' }))
    const dialog = within(await screen.findByRole('dialog'))
    await expect(dialog.getByRole('heading', { name: 'New group' })).toBeInTheDocument()
  },
}

// The role may change portals but the organisation's portal writes are off: the
// list says View, offers no New portal or New group, and says why in one line,
// where it used to offer them and let the write fail.
export const ChangesOffForTheOrganization: Story = {
  args: baseArgs,
  decorators: [PortalWritesOffDecorator],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/changing them isn’t available for your organization/i),
    ).toBeInTheDocument()
    await expect(
      canvas.getByRole('link', { name: 'View Pool & Terrace' }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('link', { name: /^edit /i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /new portal/i })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'New group' })).toBeNull()
    // Looking is still on: the Property look and the results are read.
    await expect(canvas.getByRole('link', { name: 'Property look' })).toBeInTheDocument()
    // No Review & publish where it cannot be done.
    await expect(canvas.queryByRole('link', { name: /review and publish/i })).toBeNull()
  },
}
