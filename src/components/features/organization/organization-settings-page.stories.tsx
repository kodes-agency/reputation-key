// The page is rendered over a held organization so a refresh of the read and a
// save can be told apart: the form keeps a manager's unsaved edit when the same
// organization is read again, and starts from the saved values after a save.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AuthedRouterDecorator } from '../../../../.storybook/AuthedRouterDecorator'
import { Button } from '#/components/ui/button'
import { OrganizationSettingsPage } from './organization-settings-page'

type PageProps = Parameters<typeof OrganizationSettingsPage>[0]

const saved = {
  id: 'org-1',
  name: 'Acme Hotels',
  slug: 'acme-hotels',
  logo: null,
  contactEmail: 'ops@acme.example',
}

const action = () =>
  Object.assign(
    fn(async () => ({})),
    {
      isPending: false,
      error: null,
      isSuccess: false,
      data: null,
    },
  ) as unknown as PageProps['updateOrganization']

function HeldOrganization() {
  const [organization, setOrganization] = useState(saved)
  return (
    <>
      <Button type="button" onClick={() => setOrganization({ ...organization })}>
        Read again
      </Button>
      <Button
        type="button"
        onClick={() => setOrganization({ ...organization, name: 'Acme Group' })}
      >
        Save elsewhere
      </Button>
      <OrganizationSettingsPage
        organization={organization}
        responseTargets={null}
        updateOrganization={action()}
        removeOrganizationLogo={action()}
        requestOrgLogoUploadFn={fn() as unknown as PageProps['requestOrgLogoUploadFn']}
        finalizeOrgLogo={action() as unknown as PageProps['finalizeOrgLogo']}
      />
    </>
  )
}

const meta = {
  title: 'Organization/OrganizationSettingsPage',
  component: OrganizationSettingsPage,
  parameters: { layout: 'padded' },
  decorators: [AuthedRouterDecorator],
  render: () => <HeldOrganization />,
} satisfies Meta<typeof OrganizationSettingsPage>

export default meta
type Story = StoryObj<typeof meta>

export const RefreshDuringEdit: Story = {
  args: {
    organization: saved,
    responseTargets: null,
    updateOrganization: action(),
    removeOrganizationLogo: action(),
    requestOrgLogoUploadFn: fn() as unknown as PageProps['requestOrgLogoUploadFn'],
    finalizeOrgLogo: action() as unknown as PageProps['finalizeOrgLogo'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByLabelText(/^name$/i)
    await userEvent.type(name, ' Collection')
    await userEvent.click(canvas.getByRole('button', { name: 'Read again' }))
    await expect(canvas.getByLabelText(/^name$/i)).toHaveValue('Acme Hotels Collection')

    await userEvent.click(canvas.getByRole('button', { name: 'Save elsewhere' }))
    await expect(canvas.getByLabelText(/^name$/i)).toHaveValue('Acme Group')
  },
}
