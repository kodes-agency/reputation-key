import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
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
    // One list: no Directory of every member (Settings › Members owns that), so no
    // views to switch between.
    expect(canvas.getByRole('heading', { name: 'Staff', level: 1 })).toBeInTheDocument()
    expect(canvas.queryByRole('navigation', { name: 'People views' })).toBeNull()
    expect(canvas.queryByText('Directory')).toBeNull()
    // A management list is a dashboard-tier page, like Portals and Properties.
    expect(canvasElement.querySelector('.max-w-\\[1200px\\]')).not.toBeNull()
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
        const refusal = new Error('This participation changed. Reload and try again.')
        archiveRefusals.push(refusal)
        throw refusal
      },
      { isPending: false, error: null, isSuccess: false, data: null },
    ),
  },
  play: async ({ canvasElement }) => {
    archiveRefusals.length = 0
    const unhandled: unknown[] = []
    const record = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', record)
    try {
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
      // `unhandledrejection` is dispatched from a task queued after the
      // microtask checkpoint, so wait out two task turns before reading it.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      window.removeEventListener('unhandledrejection', record)
    }
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
