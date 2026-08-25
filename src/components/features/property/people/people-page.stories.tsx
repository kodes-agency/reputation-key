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
    await expect(
      await within(document.body).findByText(/add organization members/i),
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
