import type { Meta, StoryObj } from '@storybook/react'
import { expect, screen, userEvent, within } from 'storybook/test'
import { withRole } from '../../../../../../.storybook/AuthedRouterDecorator'
import {
  StaffManagerStory,
  STAFF_STORY_MEMBERS,
  STAFF_VIEWPORTS,
} from '../../../../../../.storybook/staff-manager-fixtures'
import type { StaffMember } from './staff-account-view'
function Scene({
  access = 'active',
  code = null,
  canInvite = true,
}: Readonly<{
  access?: StaffMember['access']
  code?: string | null
  canInvite?: boolean
}>) {
  return (
    <StaffManagerStory
      initialPersonId="person-0"
      canInvite={canInvite}
      members={[
        {
          ...STAFF_STORY_MEMBERS[0]!,
          access,
          code,
          operationId: access === 'failed' ? 'operation' : null,
          step: access === 'failed' ? 'publication' : null,
        },
      ]}
    />
  )
}
const meta = {
  title: 'Staff/Person',
  component: Scene,
  parameters: { layout: 'fullscreen', viewport: { viewports: STAFF_VIEWPORTS } },
} satisfies Meta<typeof Scene>
export default meta
type Story = StoryObj<typeof meta>
export const SignedIn: Story = {
  play: async () => {
    const ui = within(await screen.findByRole('dialog', { name: 'Ana Jones' }))
    await expect(ui.getByText(/Signed in/u)).toBeVisible()
    await expect(ui.getByRole('link', { name: 'View and print' })).toBeVisible()
    await expect(ui.getByText('Maya Chen')).toBeVisible()
    await userEvent.click(ui.getByRole('button', { name: 'Rename' }))
    await expect(ui.getByRole('textbox', { name: 'Name' })).toBeVisible()
  },
}
export const Invited: Story = {
  args: { access: 'invited' },
  play: async () => {
    const ui = within(await screen.findByRole('dialog', { name: 'Ana Jones' }))
    await userEvent.click(ui.getByRole('button', { name: 'Change email' }))
    await expect(ui.getByRole('textbox', { name: 'New email' })).toBeVisible()
  },
}
export const Expired: Story = { args: { access: 'invite_expired' } }
export const Failed: Story = { args: { access: 'failed', code: 'guest_wording_missing' } }
export const SendFailed: Story = {
  args: { access: 'invited', code: 'invitation_delivery_failed' },
}
export const PropertyManager: Story = {
  decorators: [withRole('PropertyManager')],
  args: { access: 'invited' },
}
export const ReadOnly: Story = { args: { canInvite: false } }
export const Narrow320: Story = {
  globals: { viewport: { value: 'narrow', isRotated: false } },
}
export const Phone375: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
}
export const Tablet768: Story = {
  globals: { viewport: { value: 'tablet', isRotated: false } },
}
export const Desktop1440: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
}
