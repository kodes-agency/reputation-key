import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { unhandledRejectionsDuring } from '../../../../../.storybook/play-helpers'
import { PeoplePage } from './people-page'
import { seededArgs } from './people-page-stories-data'

const meta: Meta<typeof PeoplePage> = {
  title: 'Property/StaffPage',
  component: PeoplePage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof PeoplePage>

export const Populated: Story = {
  args: { ...seededArgs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Alice Adams')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /add staff/i }))
    const dialog = await within(document.body).findByRole('dialog')
    await expect(
      within(dialog).getByRole('heading', { name: /add staff participation/i }),
    ).toBeInTheDocument()
  },
}

export const Empty: Story = {
  args: {
    ...seededArgs,
    participations: [],
    responsibilities: [],
    portals: [],
  },
}

export const Loading: Story = {
  args: { ...seededArgs, state: 'loading' },
}

export const Error: Story = {
  args: {
    ...seededArgs,
    state: 'error',
    errorMessage: 'Staff is temporarily unavailable.',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Staff is temporarily unavailable.'),
    ).toBeInTheDocument()
  },
}

export const PermissionDenied: Story = {
  args: { ...seededArgs, state: 'forbidden' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/do not have permission to view staff/i),
    ).toBeInTheDocument()
  },
}

/** The page is one list: no Directory of every member, which Settings › Members owns. */
export const StaffOnly: Story = {
  args: { ...seededArgs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'Staff', level: 1 }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('tab')).not.toBeInTheDocument()
    await expect(canvas.queryByText('Directory')).not.toBeInTheDocument()
  },
}

/**
 * A refused archive is shown by the list's banner from the Action's own error,
 * so the row only settles the promise: an unsettled one surfaced as an
 * unhandled rejection, which the browser logs and the test runner fails on.
 */
const archiveRefusals: Error[] = []

export const ArchiveRefused: Story = {
  args: {
    ...seededArgs,
    // A plain function, not `fn()`: the spy attaches its own handler to every
    // promise it returns, which would mark the rejection handled.
    archiveParticipationMutation: Object.assign(
      async () => {
        // globalThis: in this file `Error` is the error-state story.
        const refusal = new globalThis.Error(
          'This participation changed. Reload and try again.',
        )
        archiveRefusals.push(refusal)
        throw refusal
      },
      { isPending: false, error: null, isSuccess: false, data: null },
    ),
  },
  play: async ({ canvasElement }) => {
    archiveRefusals.length = 0
    const unhandled = await unhandledRejectionsDuring(async () => {
      await userEvent.click(
        within(canvasElement).getByRole('button', {
          name: 'Archive staff participation for Alice Adams',
        }),
      )
      await userEvent.click(
        await within(document.body).findByRole('button', {
          name: 'Archive participation',
        }),
      )
      expect(archiveRefusals).toHaveLength(1)
    })
    expect(unhandled).toEqual([])
  },
}

export const PortalsDenied: Story = {
  args: { ...seededArgs, portals: [], portalsDenied: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Alice Adams')).toBeInTheDocument()
    await expect(
      canvas.getByText('Portal responsibilities are unavailable'),
    ).toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: /edit portal responsibilities/i }),
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: /add staff/i })).toBeInTheDocument()
  },
}
