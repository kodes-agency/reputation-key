// code-health-09: Portal and Property each had their own byte-for-byte copy of
// this card. These stories exercise the panel both consolidated onto — the
// "needs a manager" alert, an ineligible-but-still-assigned row staying
// removable while blocked from re-adding, and the Save button's dirty gate —
// so a regression here is caught once instead of twice.
import type { Meta, StoryObj } from '@storybook/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  ResponsibleManagersPanel,
  type ResponsibleManagersPanelState,
} from './responsible-managers-panel'

const MEMBERS = [
  { userId: 'user-1', name: 'Avery Morgan', email: 'avery@example.com' },
  { userId: 'user-2', name: 'Jordan Blake', email: 'jordan@example.com' },
  { userId: 'user-3', name: 'Riley Chen', email: 'riley@example.com' },
]

const COPY = {
  description:
    'Assigned managers receive this Portal’s workflow notifications. Responsibility does not grant Property access or Staff attribution.',
  alertTitle: 'Responsible manager needed',
  alertDescription:
    'Assign at least one manager so Portal updates and feedback have a clear owner. Account admins remain available for recovery.',
}

const meta: Meta<typeof ResponsibleManagersPanel> = {
  title: 'Features/ResponsibleManagers/ResponsibleManagersPanel',
  component: ResponsibleManagersPanel,
  tags: ['autodocs'],
  args: {
    members: MEMBERS,
    disabled: false,
    isPending: false,
    error: null,
    headingLevel: 'h3',
    idPrefix: 'responsible-manager',
    copy: COPY,
    onSave: async () => undefined,
  },
}
export default meta
type Story = StoryObj<typeof ResponsibleManagersPanel>

export const AssignedNoAlert: Story = {
  args: {
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Responsible manager needed')).not.toBeInTheDocument()
    await expect(canvas.getByRole('checkbox', { name: /Avery Morgan/i })).toBeChecked()
    await expect(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    ).toBeDisabled()
  },
}

export const NeedsAManager: Story = {
  args: {
    state: {
      assignments: [],
      eligibleManagers: [
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ],
      revision: 1,
      responsibilityNeeded: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Responsible manager needed')).toBeInTheDocument()
    await expect(canvas.getByText(COPY.alertDescription)).toBeInTheDocument()
  },
}

/**
 * `user-2` was assigned while eligible and lost eligibility since (its
 * `eligibleManagers` entry is gone). It must stay visible and checked, be
 * removable, and never become re-checkable — the same "capture a drift, don't
 * hide it" rule the checkbox `disabled` expression enforces for both callers.
 */
export const AssignedButNoLongerEligible: Story = {
  args: {
    state: {
      assignments: [{ userId: 'user-1' }, { userId: 'user-2' }],
      eligibleManagers: [{ userId: 'user-1' }, { userId: 'user-3' }],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const staleAssignee = canvas.getByRole('checkbox', { name: /Jordan Blake/i })
    await expect(staleAssignee).toBeChecked()
    await expect(
      canvas.getByText(/Eligibility changed; remove this assignment/i),
    ).toBeInTheDocument()

    await userEvent.click(staleAssignee)
    await expect(staleAssignee).not.toBeChecked()
    await expect(staleAssignee).toBeDisabled()
  },
}

export const SaveEnabledOnlyAfterAChange: Story = {
  args: {
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const save = canvas.getByRole('button', { name: /save responsible managers/i })
    await expect(save).toBeDisabled()

    await userEvent.click(canvas.getByRole('checkbox', { name: /Jordan Blake/i }))
    await expect(save).toBeEnabled()
  },
}

export const SavePending: Story = {
  args: {
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [{ userId: 'user-1' }],
      revision: 1,
      responsibilityNeeded: false,
    },
    isPending: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /saving/i })).toBeDisabled()
  },
}

export const SaveFailed: Story = {
  args: {
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [{ userId: 'user-1' }],
      revision: 1,
      responsibilityNeeded: false,
    },
    error: new ServerFunctionError(
      'ResponsibleManagersError',
      'Responsible managers could not be saved.',
      'conflict',
      409,
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Responsible managers could not be saved.'),
    ).toBeInTheDocument()
  },
}

/** Property's page heading is one level higher than Portal's (h2 vs h3). */
export const PropertyHeadingLevel: Story = {
  args: {
    headingLevel: 'h2',
    idPrefix: 'property-responsible-manager',
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [{ userId: 'user-1' }],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', {
        level: 2,
        name: 'Responsible managers',
      }),
    ).toBeInTheDocument()
  },
}

/** Reset puts the saved managers back, and shows only once the choice changed. */
export const ResetPutsTheSavedManagersBack: Story = {
  args: {
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()

    await userEvent.click(canvas.getByRole('checkbox', { name: /Jordan Blake/i }))
    const buttons = canvas.getAllByRole('button').map((button) => button.textContent)
    await expect(buttons).toEqual(['Reset', 'Save responsible managers'])
    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }))

    await expect(
      canvas.getByRole('checkbox', { name: /Jordan Blake/i }),
    ).not.toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: /Avery Morgan/i })).toBeChecked()
    await expect(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    ).toBeDisabled()
  },
}

// ── A selection edited across a refresh ─────────────────────────────────
//
// The stories above hand the panel one fixed `state`. These put it where the
// Property people tab and the Portal editor put it: under a query that can
// re-read, with a save that is a real `useActionMutation`. The server is the
// revision fence of `property-responsible-manager.repository.ts`: a save names
// the revision it was made against and is refused once another save has landed.

type ManagersSave = Readonly<{
  managerUserIds: readonly string[]
  expectedRevision: number
}>

const MANAGERS_KEY = ['story', 'responsible-managers'] as const
const CHANGED_SINCE = 'responsible managers changed; reload them'

function makeManagersServer() {
  const held = { managerUserIds: ['user-1'], revision: 5 }
  const received: ManagersSave[] = []
  return {
    held,
    received,
    read: async (): Promise<ResponsibleManagersPanelState> => ({
      assignments: held.managerUserIds.map((userId) => ({ userId })),
      eligibleManagers: MEMBERS.map(({ userId }) => ({ userId })),
      revision: held.revision,
      responsibilityNeeded: false,
    }),
    save: async (save: ManagersSave): Promise<void> => {
      received.push(save)
      if (save.expectedRevision !== held.revision) {
        throw new ServerFunctionError(
          'PropertyError',
          CHANGED_SINCE,
          'revision_conflict',
          409,
        )
      }
      held.managerUserIds = [...save.managerUserIds]
      held.revision += 1
    },
    /** Another admin's save, from another browser. */
    saveFromElsewhere: (managerUserIds: string[]) => {
      held.managerUserIds = managerUserIds
      held.revision += 1
    },
  }
}

let managersServer = makeManagersServer()

/**
 * The page's wiring around the panel, as `settings/people.tsx` has it: a save
 * that landed re-reads the managers, and so does one the server refused (the
 * route's own wiring is tested beside it, `settings/-people.test.ts`). The
 * buttons stand in for what the play cannot cause through the panel: another
 * admin's save (Avery and Riley, whoever was there before), with or without the
 * re-read a window refocus triggers once the read is 30 seconds old.
 */
function RefreshedUnderAnEdit() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: MANAGERS_KEY,
    queryFn: () => managersServer.read(),
  })
  const update = useActionMutation((save: ManagersSave) => managersServer.save(save), {
    invalidateKeys: [[...MANAGERS_KEY]],
    onError: () => void queryClient.invalidateQueries({ queryKey: MANAGERS_KEY }),
  })
  if (!data) return null
  return (
    <>
      <ResponsibleManagersPanel
        state={data}
        members={MEMBERS}
        disabled={false}
        isPending={update.isPending}
        error={update.error}
        headingLevel="h3"
        idPrefix="responsible-manager"
        copy={COPY}
        onSave={(managerUserIds, expectedRevision) =>
          update({ managerUserIds, expectedRevision })
        }
      />
      <p>Read at revision {data.revision}</p>
      <button
        type="button"
        onClick={() => {
          managersServer.saveFromElsewhere(['user-1', 'user-3'])
          void queryClient.invalidateQueries({ queryKey: MANAGERS_KEY })
        }}
      >
        Another admin saves Avery and Riley
      </button>
      <button
        type="button"
        onClick={() => managersServer.saveFromElsewhere(['user-1', 'user-3'])}
      >
        Another admin saves, and this page is not told
      </button>
    </>
  )
}

/**
 * An admin ticks Jordan; meanwhile another admin adds Riley, and the page
 * re-reads. The edit is kept (Riley's row shows unticked), so saving it as it
 * stands would take Riley off again. It is therefore saved with the revision it
 * was started from: the server refuses it, the admin is told, and Reset shows
 * what the other admin did. It used to be saved with the re-read revision, which
 * the server accepted, and Riley was removed with nothing said.
 */
export const AnEditKeptAcrossARefreshIsRefused: Story = {
  render: () => <RefreshedUnderAnEdit />,
  beforeEach: () => {
    managersServer = makeManagersServer()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Jordan Blake/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: 'Another admin saves Avery and Riley' }),
    )
    await canvas.findByText('Read at revision 6')
    // The edit survived the re-read: Jordan ticked, Riley as the admin left her.
    await expect(canvas.getByRole('checkbox', { name: /Jordan Blake/i })).toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: /Riley Chen/i })).not.toBeChecked()

    await userEvent.click(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    )

    await waitFor(() =>
      expect(managersServer.received).toEqual([
        { managerUserIds: ['user-1', 'user-2'], expectedRevision: 5 },
      ]),
    )
    await expect(await canvas.findByText(CHANGED_SINCE)).toBeVisible()
    // Riley is still a responsible manager.
    await expect(managersServer.held).toEqual({
      managerUserIds: ['user-1', 'user-3'],
      revision: 6,
    })

    // Reset shows the other admin's change, and the next edit is made on top of it.
    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }))
    await expect(canvas.getByRole('checkbox', { name: /Riley Chen/i })).toBeChecked()
    await userEvent.click(canvas.getByRole('checkbox', { name: /Jordan Blake/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    )

    await canvas.findByText('Read at revision 7')
    await expect(managersServer.held).toEqual({
      managerUserIds: ['user-1', 'user-2', 'user-3'],
      revision: 7,
    })
    await expect(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    ).toBeDisabled()

    // The saved edit is spent. When someone else changes the managers later,
    // the panel shows their change; it does not bring the old edit back as an
    // unsaved one.
    await userEvent.click(
      canvas.getByRole('button', { name: 'Another admin saves Avery and Riley' }),
    )
    await canvas.findByText('Read at revision 8')
    await expect(
      canvas.getByRole('checkbox', { name: /Jordan Blake/i }),
    ).not.toBeChecked()
    await expect(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    ).toBeDisabled()
  },
}

/**
 * The edit goes on after the re-read: the admin ticked Jordan, another admin
 * added Riley, and the admin then unticks Avery as well. The selection still
 * has not seen Riley, so it is still saved with the revision it was started
 * from and still refused. Taking the re-read as the base at that second change
 * would send it with the newer revision, and Riley would be removed.
 */
export const AChangeMadeAfterTheRefreshIsStillRefused: Story = {
  render: () => <RefreshedUnderAnEdit />,
  beforeEach: () => {
    managersServer = makeManagersServer()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Jordan Blake/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: 'Another admin saves Avery and Riley' }),
    )
    await canvas.findByText('Read at revision 6')

    await userEvent.click(canvas.getByRole('checkbox', { name: /Avery Morgan/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    )

    await waitFor(() =>
      expect(managersServer.received).toEqual([
        { managerUserIds: ['user-2'], expectedRevision: 5 },
      ]),
    )
    await expect(await canvas.findByText(CHANGED_SINCE)).toBeVisible()
    await expect(managersServer.held).toEqual({
      managerUserIds: ['user-1', 'user-3'],
      revision: 6,
    })
  },
}

/**
 * The other admin's save has not reached this page: nothing re-read, and the
 * read is still fresh. The save is refused all the same, and the page re-reads
 * the managers on that refusal. The panel keeps the refused edit over the new
 * read, and Reset now shows Riley, so the next save is made on top of her.
 * Without that read, Reset put back the managers the page already had and
 * every further save was refused the same way.
 */
export const ARefusedSaveReReadsTheManagers: Story = {
  render: () => <RefreshedUnderAnEdit />,
  beforeEach: () => {
    managersServer = makeManagersServer()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('checkbox', { name: /Jordan Blake/i }))
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Another admin saves, and this page is not told',
      }),
    )
    await expect(canvas.getByText('Read at revision 5')).toBeVisible()

    await userEvent.click(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    )

    await expect(await canvas.findByText(CHANGED_SINCE)).toBeVisible()
    await canvas.findByText('Read at revision 6')
    // The refused edit is kept as the admin left it, for them to judge.
    await expect(canvas.getByRole('checkbox', { name: /Jordan Blake/i })).toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: /Riley Chen/i })).not.toBeChecked()

    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }))
    await expect(canvas.getByRole('checkbox', { name: /Riley Chen/i })).toBeChecked()
    await expect(
      canvas.getByRole('checkbox', { name: /Jordan Blake/i }),
    ).not.toBeChecked()

    await userEvent.click(canvas.getByRole('checkbox', { name: /Jordan Blake/i }))
    await userEvent.click(
      canvas.getByRole('button', { name: /save responsible managers/i }),
    )

    await canvas.findByText('Read at revision 7')
    await expect(managersServer.held).toEqual({
      managerUserIds: ['user-1', 'user-2', 'user-3'],
      revision: 7,
    })
  },
}
