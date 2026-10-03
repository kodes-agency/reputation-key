// A group's page (board 13): "Pool side" at Avela Resort.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'
import { PageGutterDecorator } from '../../../../../.storybook/PageGutterDecorator'
import { action, baseArgs } from '../portal-list-page-stories-data'
import {
  indexOverviewResults,
  type PortalOverviewResultsState,
} from '../portal-overview/portal-overview-results'
import { avelaResults } from '../portal-overview/portal-overview-results-fixtures'
import { PortalGroupPage } from './portal-group-page'
import {
  HISTORY,
  NAMES,
  NOW,
  PEOPLE,
  POOL_SIDE,
  RATINGS_GOAL,
  ZONE,
  ready,
} from './portal-group-page-fixtures'

const READY: PortalOverviewResultsState = {
  status: 'ready',
  index: indexOverviewResults(avelaResults()),
}

const meta: Meta<typeof PortalGroupPage> = {
  title: 'Portal/PortalGroup/GroupPage',
  component: PortalGroupPage,
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator, PageGutterDecorator],
  args: {
    propertyId: 'prop-1',
    propertyName: 'Avela Resort',
    timezone: ZONE,
    group: POOL_SIDE,
    rows: baseArgs.rows,
    members: baseArgs.members,
    results: {
      state: READY,
      timeRange: '30d',
      onTimeRangeChange: fn(),
      onRetry: fn(),
    },
    goals: ready([RATINGS_GOAL]),
    history: ready(HISTORY),
    names: NAMES,
    personName: PEOPLE,
    now: NOW,
    onRetryGoals: fn(),
    onRetryHistory: fn(),
    archiveMutation: baseArgs.archiveMutation,
    restoreMutation: baseArgs.restoreMutation,
    disableMutation: baseArgs.disableMutation,
    renameMutation: baseArgs.renameMutation,
    archiveGroupMutation: baseArgs.archiveGroupMutation,
    movePortalMutation: action<{ data: { portalGroupId: string; portalId: string } }>(),
    removePortalMutation: action<{ data: { portalGroupId: string; portalId: string } }>(),
  },
}
export default meta
type Story = StoryObj<typeof PortalGroupPage>

export const Default: Story = {}

export const HeaderSaysWhatAGroupIs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 1, name: 'Pool side' }),
    ).toBeInTheDocument()
    await expect(
      canvas.getByText(
        'Group · 3 portals at Avela Resort · for shared results and goals',
      ),
    ).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    // One in the header, and the quiet one under the table.
    await expect(canvas.getAllByRole('button', { name: 'Add portal' })).toHaveLength(2)
    await expect(
      canvas.getByRole('button', { name: 'Actions for group Pool side' }),
    ).toBeInTheDocument()
  },
}

// The strip is the group's own five figures, with shares of the group's scans.
export const ResultsAreTheGroupsOwn: Story = {
  play: async ({ canvasElement }) => {
    const strip = within(within(canvasElement).getByLabelText('Portal results'))
    await expect(strip.getByText('698')).toBeInTheDocument()
    await expect(strip.getByText('209')).toBeInTheDocument()
    await expect(strip.getByText('30% of scans')).toBeInTheDocument()
    await expect(strip.getByText('116')).toBeInTheDocument()
    await expect(strip.getByText('17% of scans')).toBeInTheDocument()
    await expect(strip.getByText('13')).toBeInTheDocument()
    await expect(
      within(canvasElement).getByText(/1–30 Sep, Europe\/Sofia time · this group/),
    ).toBeInTheDocument()
  },
}

// Only the three portals of the group: no group heads, no portal from elsewhere.
export const ListsOnlyThePortalsInTheGroup: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = within(canvas.getByRole('table', { name: /portals at avela resort/i }))
    for (const name of ['Pool & Terrace', 'Spa & thermal pools', 'Pool bar']) {
      await expect(table.getByRole('link', { name })).toBeInTheDocument()
    }
    await expect(canvas.queryByRole('link', { name: 'Reception' })).toBeNull()
    await expect(table.queryByText('Not in a group')).toBeNull()
    await expect(
      canvas.getByText(
        'Group results count each portal from the day it joined. Averages need 5 private ratings.',
      ),
    ).toBeInTheDocument()
    await expect(
      canvas.getByText('A portal can be in one group at a time.'),
    ).toBeInTheDocument()
  },
}

// A draft has no code to give out, so its row has no Share link. The place stays,
// unseen and hidden from a screen reader, so Edit sits where it does in the rows
// that have one (the geometry is measured against real CSS in the metrics suite).
export const DraftRowKeepsTheSharePlace: Story = {
  play: async ({ canvasElement }) => {
    const table = within(
      within(canvasElement).getByRole('table', { name: /portals at avela resort/i }),
    )
    const draft = within(table.getByRole('link', { name: 'Pool bar' }).closest('tr')!)
    await expect(draft.queryByRole('link', { name: /^Share / })).toBeNull()
    await expect(draft.getByText('Share').closest('[aria-hidden="true"]')).not.toBeNull()
    // The rows that can be shared keep their link.
    const live = within(
      table.getByRole('link', { name: 'Pool & Terrace' }).closest('tr')!,
    )
    await expect(
      live.getByRole('link', { name: 'Share Pool & Terrace' }),
    ).toBeInTheDocument()
  },
}

export const GoalCardIsLiveAndNeutral: Story = {
  play: async ({ canvasElement }) => {
    const card = within(
      within(canvasElement).getByRole('article', { name: 'September · Private ratings' }),
    )
    await expect(card.getByText('209')).toBeInTheDocument()
    await expect(card.getByText('of 250 so far')).toBeInTheDocument()
    await expect(
      card.getByRole('progressbar', {
        name: 'Private ratings: 209 of 250 so far this month',
      }),
    ).toHaveAttribute('aria-valuenow', '84')
    await expect(
      card.getByText('Set by Elena Petrova · the month ends today'),
    ).toBeInTheDocument()
    await expect(card.getByRole('link', { name: /open in goals/i })).toBeInTheDocument()
  },
}

export const HistoryTellsWhatHappenedNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const history = within(within(canvasElement).getByRole('region', { name: 'History' }))
    await expect(
      history.getByText(/Georgi Ivanov renamed Pools to Pool side/),
    ).toBeInTheDocument()
    await expect(
      history.getByText(/Spa & thermal pools moved here from Wellness/),
    ).toBeInTheDocument()
    await expect(
      history.getByText('Its results before 12 Aug stay with Wellness'),
    ).toBeInTheDocument()
    await expect(
      history.getByText(/Elena Petrova created Pools with 3 portals/),
    ).toBeInTheDocument()
    await expect(
      history.getByText('Pool & Terrace, Pool bar and Spa & thermal pools'),
    ).toBeInTheDocument()
    await expect(history.getByText('Newest first')).toBeInTheDocument()
  },
}

export const NoGoalYet: Story = {
  args: { goals: ready([]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no goal for this group yet/i)).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Set a goal' })).toBeInTheDocument()
  },
}

export const AverageTooThinToShow: Story = {
  args: {
    goals: ready([
      {
        ...RATINGS_GOAL,
        metric: 'portal_rating_average',
        targetValue: 4.6,
        reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 },
      },
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Too few ratings so far: 6 of the 10 an average needs'),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

export const GoalNotOfferedToThisReader: Story = {
  args: { goals: { status: 'off' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('heading', { name: 'Goal' }),
    ).toBeNull()
  },
}

export const SideReadsWaitAndFailAlone: Story = {
  args: { goals: { status: 'loading' }, history: { status: 'failed', retrying: false } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Loading the goal')).toBeInTheDocument()
    await expect(canvas.getByText('The history couldn’t be loaded.')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.onRetryHistory).toHaveBeenCalled()
    // The portals are unaffected.
    await expect(canvas.getByRole('link', { name: 'Pool & Terrace' })).toBeInTheDocument()
  },
}

export const EmptyGroup: Story = {
  args: {
    group: { id: 'group-quiet', name: 'Quiet corner' },
    goals: ready([]),
    history: ready([]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No portals in this group yet')).toBeInTheDocument()
    await expect(
      canvas.getByText('Nothing has happened to this group yet.'),
    ).toBeInTheDocument()
    await expect(
      canvas.getByText(
        'Group · 0 portals at Avela Resort · for shared results and goals',
      ),
    ).toBeInTheDocument()
  },
}

export const WithoutResults: Story = {
  args: { results: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText('Portal results')).toBeNull()
    await expect(canvas.getByRole('link', { name: 'Pool & Terrace' })).toBeInTheDocument()
  },
}

// A reader who may not update sees the group and its portals, and changes nothing.
export const ViewOnly: Story = {
  decorators: [withRole('Member')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Rename' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Add portal' })).toBeNull()
    await expect(canvas.getByRole('link', { name: 'Pool & Terrace' })).toBeInTheDocument()
  },
}

const spy = <TInput,>() =>
  Object.assign(
    fn(async (_input: TInput) => undefined),
    { isPending: false, error: null, isSuccess: false, data: null },
  )

export const ArchivingAsksFirstAndKeepsThePortals: Story = {
  args: { archiveGroupMutation: spy<{ data: { portalGroupId: string } }>() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Actions for group Pool side' }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive group…' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    await expect(
      dialog.getByRole('heading', { name: 'Archive Pool side?' }),
    ).toBeInTheDocument()
    await expect(
      dialog.getByText(/portals stay and become “Not in a group”/i),
    ).toBeInTheDocument()
    await expect(args.archiveGroupMutation).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Archive group' }))
    await waitFor(() =>
      expect(args.archiveGroupMutation).toHaveBeenCalledWith({
        data: { portalGroupId: 'group-pool' },
      }),
    )
  },
}

async function chooseRemoveFromGroup(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'More actions for Pool bar' }),
  )
  await userEvent.click(
    await screen.findByRole('menuitem', { name: 'Remove from group' }),
  )
  return within(await screen.findByRole('alertdialog'))
}

/** The menu item asks first; the portal leaves the group only when that is confirmed. */
export const RemovingAPortalTakesItOutOfTheGroup: Story = {
  args: {
    removePortalMutation: spy<{ data: { portalGroupId: string; portalId: string } }>(),
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await chooseRemoveFromGroup(canvasElement)
    await expect(
      dialog.getByRole('heading', { name: 'Remove Pool bar from Pool side?' }),
    ).toBeInTheDocument()
    await expect(args.removePortalMutation).not.toHaveBeenCalled()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove from group' }))
    await waitFor(() =>
      expect(args.removePortalMutation).toHaveBeenCalledWith({
        data: { portalGroupId: 'group-pool', portalId: 'p-bar' },
      }),
    )
  },
}

export const KeepingAPortalInTheGroup: Story = {
  args: {
    removePortalMutation: spy<{ data: { portalGroupId: string; portalId: string } }>(),
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await chooseRemoveFromGroup(canvasElement)
    await userEvent.click(dialog.getByRole('button', { name: 'Keep in group' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await expect(args.removePortalMutation).not.toHaveBeenCalled()
  },
}

export const AddPortalOffersThePortalsNotInThisGroup: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getAllByRole('button', { name: 'Add portal' })[0]!,
    )
    const dialog = within(await screen.findByRole('dialog'))
    await expect(
      dialog.getByRole('heading', { name: 'Add portals to Pool side' }),
    ).toBeInTheDocument()
    await expect(
      dialog.getByRole('checkbox', { name: /olive terrace/i }),
    ).toBeInTheDocument()
    await expect(dialog.getByRole('checkbox', { name: /reception/i })).toBeInTheDocument()
    await expect(dialog.queryByRole('checkbox', { name: /pool & terrace/i })).toBeNull()
  },
}
