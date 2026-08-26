import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { PortalPublicationHistoryCard } from './portal-publication-history-card'

const meta: Meta<typeof PortalPublicationHistoryCard> = {
  title: 'Portal/PortalPublicationHistoryCard',
  component: PortalPublicationHistoryCard,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof PortalPublicationHistoryCard>

export const LiveVersionMatchesSavedSettings: Story = {
  args: {
    history: {
      current: {
        activationSequence: 1,
        version: 1,
        kind: 'publish',
        activatedAt: '2026-08-25T10:00:00.000Z',
        deactivatedAt: null,
        deactivationReason: null,
      },
      priorActivations: [],
      hasPendingChanges: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Publication history' }),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Version 1 is live')).toBeInTheDocument()
    await expect(
      canvas.getByText('Saved settings match the live version.'),
    ).toBeInTheDocument()
    await expect(canvas.getByText('No earlier publication activity yet.')).toBeVisible()
  },
}

export const SavedChangesAfterRollback: Story = {
  args: {
    history: {
      current: {
        activationSequence: 3,
        version: 1,
        kind: 'rollback',
        activatedAt: '2026-08-26T14:00:00.000Z',
        deactivatedAt: null,
        deactivationReason: null,
      },
      priorActivations: [
        {
          activationSequence: 2,
          version: 2,
          kind: 'publish',
          activatedAt: '2026-08-26T13:00:00.000Z',
          deactivatedAt: '2026-08-26T14:00:00.000Z',
          deactivationReason: 'replaced',
        },
        {
          activationSequence: 1,
          version: 1,
          kind: 'publish',
          activatedAt: '2026-08-25T10:00:00.000Z',
          deactivatedAt: '2026-08-26T13:00:00.000Z',
          deactivationReason: 'replaced',
        },
      ],
      hasPendingChanges: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Version 1 is live')).toBeInTheDocument()
    await expect(canvas.getByText(/returned to this version/i)).toBeInTheDocument()
    await expect(
      canvas.getByText(/saved changes are ready for the next publication/i),
    ).toBeInTheDocument()
    await expect(canvas.getByText('Version 2 published')).toBeInTheDocument()
    await expect(canvas.getByText('Version 1 published')).toBeInTheDocument()
  },
}

export const PausedWithRetainedHistory: Story = {
  args: {
    history: {
      current: null,
      priorActivations: [
        {
          activationSequence: 1,
          version: 1,
          kind: 'publish',
          activatedAt: '2026-08-25T10:00:00.000Z',
          deactivatedAt: '2026-08-26T14:00:00.000Z',
          deactivationReason: 'disabled',
        },
      ],
      hasPendingChanges: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/no version is live right now/i)).toBeInTheDocument()
    await expect(
      canvas.getByText('Saved settings match the most recently published version.'),
    ).toBeInTheDocument()
    await expect(canvas.getByText(/public page paused/i)).toBeInTheDocument()
  },
}

export const PausedWithSavedChanges: Story = {
  args: {
    history: {
      current: null,
      priorActivations: [
        {
          activationSequence: 1,
          version: 1,
          kind: 'publish',
          activatedAt: '2026-08-25T10:00:00.000Z',
          deactivatedAt: '2026-08-26T14:00:00.000Z',
          deactivationReason: 'disabled',
        },
      ],
      hasPendingChanges: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/they will appear when the public page is published again/i),
    ).toBeInTheDocument()
    await expect(canvas.queryByText(/guests continue to see/i)).toBeNull()
  },
}
