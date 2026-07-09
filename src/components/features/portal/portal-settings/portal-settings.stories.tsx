// Portal settings — active toggle, EditPortalForm, theme presets, smart routing.
// Uses usePermissions() (AccountAdmin → controls enabled), so it needs the
// AuthedRouterDecorator. The active Switch both calls onIsActiveChange and
// fires the mutation; the Save Changes button triggers the edit form via
// formRef. Stories cover: active/inactive, toggle interaction, save in flight,
// smart-routing expanded.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { PortalSettings } from './portal-settings'
import type { Action } from '#/components/hooks/use-action'
import type { PortalData, UpdatePortalVariables } from '../shared/types'
import { AuthedRouterDecorator } from '../../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof PortalSettings> = {
  title: 'Portal/PortalSettings',
  component: PortalSettings,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof PortalSettings>

type FormRefHandle = { handleSubmit: () => void }
type FormRef = { current: FormRefHandle | null }

const portal: PortalData = {
  id: 'p-1',
  name: 'Guest Services',
  slug: 'guest-services',
  description: 'Main guest-facing portal.',
  heroImageUrl: null,
  theme: { primaryColor: '#6366f1' },
  smartRoutingEnabled: true,
  smartRoutingThreshold: 4,
  isActive: true,
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
  primaryColor: '#6366f1',
  onPrimaryColorChange: fn(),
  smartRoutingEnabled: true,
  onSmartRoutingEnabledChange: fn(),
  smartRoutingThreshold: 4,
  onSmartRoutingThresholdChange: fn(),
  isActive: true,
  onIsActiveChange: fn(),
  requestUploadUrl,
  finalizeUpload,
  formRef: { current: null } as FormRef,
}

// Active portal — toggle on, smart routing expanded.
export const Active: Story = {
  args: { ...baseArgs },
}

// Inactive portal — guests see "unavailable"; toggle off.
export const Inactive: Story = {
  args: {
    ...baseArgs,
    isActive: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/guests will see an/i)).toBeInTheDocument()
  },
}

// Toggling active fires onIsActiveChange with the new value AND the mutation.
export const ToggleActive: Story = {
  args: {
    ...baseArgs,
    isActive: false,
    onIsActiveChange: fn(),
    mutation: Object.assign(
      fn(async (_input: UpdatePortalVariables) => ({ success: true })),
      { isPending: false, error: null as unknown, isSuccess: false, data: null },
    ) as unknown as Action<UpdatePortalVariables, { success: boolean }>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('switch', { name: /portal active/i })
    await userEvent.click(toggle)
    const onIsActiveChange = ToggleActive.args?.onIsActiveChange
    await waitFor(() => expect(onIsActiveChange).toHaveBeenCalledWith(true))
  },
}

// Smart routing disabled → the threshold panel is hidden.
export const SmartRoutingDisabled: Story = {
  args: {
    ...baseArgs,
    smartRoutingEnabled: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/rating threshold/i)).toBeNull()
  },
}

// Save in flight — Save Changes shows "Saving..." and the toggle is disabled.
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
    await expect(canvas.getByRole('button', { name: /saving/i })).toBeInTheDocument()
    // Active toggle is disabled while a save is pending.
    await expect(canvas.getByRole('switch', { name: /portal active/i })).toBeDisabled()
  },
}
