import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { InvitationSummary } from './invitation-summary'

const base = {
  organizationName: 'Meridian Hotels',
  inviterName: 'Dana Whitfield',
  role: 'PropertyManager' as const,
  propertyNames: ['Harbour View', 'Old Town Inn'],
  expiresAt: new Date('2026-10-07T12:00:00.000Z'),
}

const meta = {
  title: 'Identity/Registration/InvitationSummary',
  component: InvitationSummary,
  args: { invitation: base },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[26rem] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InvitationSummary>

export default meta
type Story = StoryObj<typeof meta>

export const PropertyManager: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Property Manager')).toBeInTheDocument()
    await expect(canvas.getByText('Harbour View')).toBeInTheDocument()
    await expect(canvas.getByText('7 Oct 2026')).toBeInTheDocument()
  },
}

export const AccountAdmin: Story = {
  args: { invitation: { ...base, role: 'AccountAdmin', propertyNames: [] } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Every Property in the Organization'),
    ).toBeInTheDocument()
  },
}

export const InviterGone: Story = {
  args: { invitation: { ...base, inviterName: null } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText('Invited by')).not.toBeInTheDocument()
  },
}

export const NoPropertiesYet: Story = {
  args: { invitation: { ...base, propertyNames: [] } },
}

export const ManyProperties: Story = {
  args: {
    invitation: {
      ...base,
      propertyNames: Array.from({ length: 12 }, (_, index) => `Hotel ${index + 1}`),
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('and 4 more')).toBeInTheDocument()
  },
}
