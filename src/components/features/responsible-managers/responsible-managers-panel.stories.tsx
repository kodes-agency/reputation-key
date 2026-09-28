// code-health-09: Portal and Property each had their own byte-for-byte copy of
// this card. These stories exercise the panel both consolidated onto — the
// "needs a manager" alert, an ineligible-but-still-assigned row staying
// removable while blocked from re-adding, and the Save button's dirty gate —
// so a regression here is caught once instead of twice.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { ResponsibleManagersPanel } from './responsible-managers-panel'

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
    error: new Error('Responsible managers could not be saved.'),
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
