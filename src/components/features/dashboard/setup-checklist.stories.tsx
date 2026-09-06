import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import type { SetupChecklist } from '#/contexts/dashboard/application/public-api'
import { propertyId } from '#/shared/domain/ids'
import { SetupChecklistPanel } from './setup-checklist'

const COMPLETED_AT = new Date('2026-08-20T10:00:00.000Z')
const PROPERTY_ID = propertyId('10000000-0000-4000-8000-000000000001')
const STEP_KEYS = [
  'google_connection',
  'initial_review_sync',
  'published_portal',
  'responsible_managers',
] as const
const complete: SetupChecklist = {
  role: 'AccountAdmin',
  accessState: 'organization',
  state: 'complete',
  steps: STEP_KEYS.map((key) => ({
    key,
    status: 'complete',
    firstCompletedAt: COMPLETED_AT,
    action: null,
  })),
}

const meta: Meta<typeof SetupChecklistPanel> = {
  title: 'Dashboard/SetupChecklist',
  component: SetupChecklistPanel,
  args: { checklist: complete },
}
export default meta
type Story = StoryObj<typeof SetupChecklistPanel>

export const Complete: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('4 of 4 milestones reached')).toBeVisible()
    await expect(canvas.getByText('Connect Google')).toBeVisible()
    await expect(canvas.getByText('Publish a guest portal')).toBeVisible()
  },
}

export const HistoricallyCompleteButDegraded: Story = {
  args: {
    checklist: {
      ...complete,
      state: 'degraded',
      steps: complete.steps.map((step) =>
        step.key === 'google_connection'
          ? { ...step, status: 'degraded' as const }
          : step,
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('4 of 4 milestones reached')).toBeVisible()
    await expect(canvas.getByText(/check setup/i)).toBeVisible()
  },
}

export const PropertyManagerWaiting: Story = {
  args: {
    checklist: {
      role: 'PropertyManager',
      accessState: 'assigned',
      state: 'waiting',
      steps: complete.steps.map((step) => ({
        ...step,
        status: 'waiting' as const,
        firstCompletedAt: null,
      })),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText(/waiting for an account admin/i)).toHaveLength(4)
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument()
  },
}

export const AccountAdminInProgress: Story = {
  args: {
    checklist: {
      role: 'AccountAdmin',
      accessState: 'organization',
      state: 'in_progress',
      steps: [
        {
          key: 'google_connection',
          status: 'incomplete',
          firstCompletedAt: null,
          action: { kind: 'manage_google', propertyId: null },
        },
        {
          key: 'initial_review_sync',
          status: 'incomplete',
          firstCompletedAt: null,
          action: { kind: 'manage_google', propertyId: PROPERTY_ID },
        },
        {
          key: 'published_portal',
          status: 'incomplete',
          firstCompletedAt: null,
          action: { kind: 'manage_portals', propertyId: PROPERTY_ID },
        },
        {
          key: 'responsible_managers',
          status: 'incomplete',
          firstCompletedAt: null,
          action: { kind: 'assign_managers', propertyId: PROPERTY_ID },
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('0 of 4 milestones reached')).toBeVisible()
    await expect(canvas.getAllByText(/next step/i)).toHaveLength(4)
    await expect(canvas.getAllByRole('link')).toHaveLength(4)
  },
}

export const PropertyManagerPartiallyAssigned: Story = {
  args: {
    checklist: {
      role: 'PropertyManager',
      accessState: 'assigned',
      state: 'in_progress',
      steps: complete.steps.map((step) => ({
        ...step,
        status:
          step.key === 'published_portal' || step.key === 'responsible_managers'
            ? ('incomplete' as const)
            : ('waiting' as const),
        firstCompletedAt: null,
        action:
          step.key === 'published_portal'
            ? { kind: 'manage_portals' as const, propertyId: PROPERTY_ID }
            : step.key === 'responsible_managers'
              ? { kind: 'assign_managers' as const, propertyId: PROPERTY_ID }
              : null,
      })),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText(/waiting for an account admin/i)).toHaveLength(2)
    await expect(canvas.getAllByRole('link')).toHaveLength(2)
  },
}

export const PropertyManagerNoAccess: Story = {
  args: {
    checklist: {
      role: 'PropertyManager',
      accessState: 'no_access',
      state: 'no_access',
      steps: complete.steps.map((step) => ({
        ...step,
        status: 'no_access' as const,
        firstCompletedAt: null,
      })),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText(/no property access/i)).toHaveLength(4)
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument()
  },
}
