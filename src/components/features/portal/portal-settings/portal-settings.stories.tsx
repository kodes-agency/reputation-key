import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { useRef, type ComponentProps } from 'react'
import { PortalSettings } from './portal-settings'
import type { Action } from '#/components/hooks/use-action'
import type { FormLike, PortalData, UpdatePortalVariables } from '../shared/types'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'

function PortalSettingsWithRef(
  props: Omit<ComponentProps<typeof PortalSettings>, 'formRef'>,
) {
  const formRef = useRef<FormLike | null>(null)
  return <PortalSettings {...props} formRef={formRef} />
}

const meta: Meta<typeof PortalSettings> = {
  title: 'Portal/PortalSettings',
  component: PortalSettings,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
  render: (args) => <PortalSettingsWithRef {...args} />,
}
export default meta
type Story = StoryObj<typeof PortalSettings>

const portal: PortalData = {
  id: 'p-1',
  name: 'Guest Services',
  slug: 'guest-services',
  description: 'Main guest-facing portal.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1' },
  publicationState: 'published',
}

const requestUploadUrl = async (_input: {
  data: { portalId: string; contentType: string; fileSize: number }
}) => ({ uploadUrl: 'https://upload.example.com/presigned', key: 'hero-key' })
const finalizeUpload = async (_input: { data: { portalId: string; key: string } }) => ({
  heroImageUrl: 'https://cdn.example.com/hero.png',
})

const idleMutation = Object.assign(
  async (_input: UpdatePortalVariables) => ({ success: true }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: boolean }>

const baseArgs = {
  portal,
  mutation: idleMutation,
  primaryColor: portal.theme.primaryColor,
  onPrimaryColorChange: fn(),
  requestUploadUrl,
  finalizeUpload,
}

export const Published: Story = {
  args: { ...baseArgs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /disable public page/i }),
    ).toBeInTheDocument()
  },
}

export const Disabled: Story = {
  args: {
    ...baseArgs,
    portal: { ...portal, publicationState: 'disabled' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /publish portal/i }),
    ).toBeInTheDocument()
  },
}

export const Archived: Story = {
  args: {
    ...baseArgs,
    portal: { ...portal, publicationState: 'archived' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(/configuration and history are retained/i),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: /publish portal/i })).toBeNull()
  },
}

export const PublicationMutation: Story = {
  args: {
    ...baseArgs,
    portal: { ...portal, publicationState: 'disabled' },
    mutation: Object.assign(
      fn(async (_input: UpdatePortalVariables) => ({ success: true })),
      { isPending: false, error: null as unknown, isSuccess: false, data: null },
    ) as unknown as Action<UpdatePortalVariables, { success: boolean }>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /publish portal/i }))
    await waitFor(() => expect(PublicationMutation.args?.mutation).toHaveBeenCalled())
  },
}

export const Saving: Story = {
  args: {
    ...baseArgs,
    mutation: Object.assign(
      async () => {
        const { promise } = Promise.withResolvers<{ success: boolean }>()
        return promise
      },
      { isPending: true, error: null as unknown, isSuccess: false, data: null },
    ) as Action<UpdatePortalVariables, { success: boolean }>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /saving/i })).toBeDisabled()
  },
}

export const MutationError: Story = {
  args: {
    ...baseArgs,
    mutation: Object.assign(
      async (_input: UpdatePortalVariables) => {
        throw new Error('The portal could not be updated. Try again.')
      },
      {
        isPending: false,
        error: new Error('The portal could not be updated. Try again.'),
        isSuccess: false,
        data: null,
      },
    ) as Action<UpdatePortalVariables, never>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(/could not be updated/i)
  },
}
