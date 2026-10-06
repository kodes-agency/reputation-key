// Organization settings form — edit the beta organization identity.
// The form is fully prop-driven (organization data + onSubmit callback + pending/error flags),
// so it renders without any server/RPC. Story the form directly to keep this
// interaction contract independent from the route's server-function wiring.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { OrganizationSettingsForm } from './organization-settings-form'
import type { UpdateOrgSettingsInput } from '#/contexts/identity/application/dto/update-org-settings.dto'

const organization = {
  name: 'Acme Hotels',
  slug: 'acme-hotels',
  contactEmail: 'ops@acme.example',
}

const meta: Meta<typeof OrganizationSettingsForm> = {
  title: 'Organization/OrganizationSettingsForm',
  component: OrganizationSettingsForm,
  tags: ['autodocs'],
  // The form fills the width the page gives it, as it does in Settings, so the story
  // gives it a column to fill: `centered` shrinks a Card to its content, a phone-wide
  // sliver whose inputs cut their values off.
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof OrganizationSettingsForm>

export const Default: Story = {
  args: {
    organization,
    onSubmit: async (_values: UpdateOrgSettingsInput) => {},
    isPending: false,
    error: null,
  },
}

// Slug edit — no warning. Guest links are /p/<token>, and no link, email,
// QR code or NFC tag carries the organization slug, so a new one breaks nothing.
export const SlugEdit: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slugInput = canvas.getByLabelText(/slug/i)
    await userEvent.clear(slugInput)
    await userEvent.type(slugInput, 'acme-renamed')
    await expect(slugInput).toHaveValue('acme-renamed')
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}

// Submit pending — Save button shows spinner + is disabled.
export const Submitting: Story = {
  args: {
    ...Default.args,
    isPending: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /save organization/i }),
    ).toBeDisabled()
  },
}

// Server error surfaced via the FormErrorBanner.
export const WithError: Story = {
  args: {
    ...Default.args,
    error: new Error('Slug is already taken by another organization.'),
  },
}

// The actions are in the identity card, Reset puts the saved identity back, and
// there is no Cancel link to Profile.
export const ResetRestoresTheSavedIdentity: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('link', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    const name = canvas.getByLabelText(/^name$/i)
    await userEvent.type(name, ' Group')
    await userEvent.click(await canvas.findByRole('button', { name: 'Reset' }))
    expect(name).toHaveValue('Acme Hotels')
    const save = canvas.getByRole('button', { name: /save organization/i })
    expect(save.closest('[data-slot="card-footer"]')).not.toBeNull()
    // The contact email may be left empty, and says so.
    expect(canvas.getByLabelText(/contact email/i)).toHaveAccessibleName(
      'Contact email Optional',
    )
  },
}
