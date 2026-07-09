// Organization settings form — edit organization identity + billing.
// The form is fully prop-driven (organization data + onSubmit callback + pending/error flags),
// so it renders without any server/RPC. The sibling `organization-settings-page.tsx` is
// UN-STORYABLE: it value-imports `setActiveOrganization` from `#/contexts/identity/server/...`
// and cannot be mocked within the boundary gate — story the form directly instead.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, within } from 'storybook/test'
import { OrganizationSettingsForm } from './organization-settings-form'
import type { UpdateOrgSettingsInput } from '#/contexts/identity/application/dto/update-org-settings.dto'

const organization = {
  name: 'Acme Hotels',
  slug: 'acme-hotels',
  contactEmail: 'ops@acme.example',
  billingCompanyName: 'Acme Hospitality LLC',
  billingAddress: '100 Market St',
  billingCity: 'San Francisco',
  billingPostalCode: '94105',
  billingCountry: 'USA',
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
