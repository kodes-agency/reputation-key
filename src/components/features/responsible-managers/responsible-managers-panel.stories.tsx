// code-health-09: Portal and Property each had their own byte-for-byte copy of
// this card. These stories exercise the panel both consolidated onto — the
// "needs a manager" alert, an ineligible-but-still-assigned row staying
// removable while blocked from re-adding, and the Save button's dirty gate —
// so a regression here is caught once instead of twice.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { ResponsibleManagersPanel } from './responsible-managers-panel'

const MEMBERS = [
  { userId: 'user-1', name: 'Avery Morgan', email: 'avery@example.com' },
  { userId: 'user-2', name: 'Jordan Blake', email: 'jordan@example.com' },
  { userId: 'user-3', name: 'Riley Chen', email: 'riley@example.com' },
]

const COPY = {
  description: 'Choosing someone here doesn’t give them access to the property.',
  alertTitle: 'No one is responsible',
  alertDescription:
    'Choose at least one manager, so someone hears about this portal’s private feedback.',
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
    await expect(canvas.queryByText('No one is responsible')).not.toBeInTheDocument()
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
    await expect(canvas.getByText('No one is responsible')).toBeInTheDocument()
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
      canvas.getByText(/can no longer be chosen; untick to remove/i),
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

/**
 * In the portal editor the section title already says "Responsible", so the
 * panel draws no heading of its own; the names sit at the start of each row,
 * beside their checkbox (the Label primitive centres its items otherwise).
 */
export const NoHeadingInsideTheEditor: Story = {
  args: {
    headingLevel: null,
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [{ userId: 'user-1' }],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('heading')).not.toBeInTheDocument()
    await expect(canvas.getByText('Avery Morgan').closest('label')).toHaveClass(
      'items-start',
    )
  },
}

const onDirtyChange = fn<(dirty: boolean) => void>()

/** A page hears when ticks wait for Save, so its leave guard can ask before they are lost. */
export const TellsThePageWhenTicksWaitForSave: Story = {
  args: {
    onDirtyChange,
    state: {
      assignments: [{ userId: 'user-1' }],
      eligibleManagers: [{ userId: 'user-1' }, { userId: 'user-2' }],
      revision: 1,
      responsibilityNeeded: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await userEvent.click(canvas.getByRole('checkbox', { name: /Jordan Blake/i }))
    await expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(canvas.getByRole('checkbox', { name: /Jordan Blake/i }))
    await expect(onDirtyChange).toHaveBeenLastCalledWith(false)
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
