import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { PeoplePage } from './people-page'
import { seededArgs } from './people-page-stories-data'

const meta: Meta<typeof PeoplePage> = {
  title: 'Property/PeoplePage',
  component: PeoplePage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof PeoplePage>

export const Populated: Story = {
  args: { ...seededArgs, tab: 'staff' },
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
    tab: 'staff',
  },
}

export const Loading: Story = {
  args: { ...seededArgs, state: 'loading' },
}

export const Error: Story = {
  args: {
    ...seededArgs,
    state: 'error',
    errorMessage: 'People are temporarily unavailable.',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('People are temporarily unavailable.'),
    ).toBeInTheDocument()
  },
}

export const PermissionDenied: Story = {
  args: { ...seededArgs, state: 'forbidden' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/do not have permission to view people/i),
    ).toBeInTheDocument()
  },
}

export const Directory: Story = {
  args: { ...seededArgs, tab: 'directory' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Alice Adams')).toBeInTheDocument()
    await expect(canvas.getByText('bob@acme.com')).toBeInTheDocument()
    // Roles read as they do on the Members page (RoleBadge), never as the raw token.
    await expect(canvas.getByText('Admin')).toBeInTheDocument()
    await expect(canvas.getByText('Member')).toBeInTheDocument()
    await expect(canvas.getByText('Manager')).toBeInTheDocument()
    await expect(canvas.queryByText('AccountAdmin')).toBeNull()
    await expect(canvas.queryByText('PropertyManager')).toBeNull()
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
    tab: 'staff',
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
  args: { ...seededArgs, portals: [], portalsDenied: true, tab: 'staff' },
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
