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
  parameters: { layout: 'centered' },
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByText(/^billing$/i)).toBeNull()
    expect(canvas.queryByLabelText(/billing|postal/i)).toBeNull()
  },
}

// Slug-change warning — editing the slug warns that guest portal URLs will break.
export const SlugWarning: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slugInput = canvas.getByLabelText(/slug/i)
    await userEvent.clear(slugInput)
    await userEvent.type(slugInput, 'acme-renamed')
    // The slug-changed warning renders reactively via form.Subscribe once
    // the slug field diverges from the persisted organization.slug.
    await expect(await canvas.findByText(/changing the slug will break/i)).toBeVisible()
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
    await expect(canvas.getByRole('button', { name: /save changes/i })).toBeDisabled()
  },
}

// Server error surfaced via the FormErrorBanner.
export const WithError: Story = {
  args: {
    ...Default.args,
    error: new Error('Slug is already taken by another organization.'),
  },
}
