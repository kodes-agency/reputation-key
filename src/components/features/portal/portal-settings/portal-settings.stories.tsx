import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { useRef, type ComponentProps } from 'react'
import { PortalSettings } from './portal-settings'
import type { Action } from '#/components/hooks/use-action'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  FormLike,
  PortalData,
  UpdatePortalVariables,
} from '../shared/types'
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
  privateFeedbackThreshold: 3,
  publicationState: 'published',
}

const requestUploadUrl = async (_input: {
  data: { portalId: string; contentType: string; fileSize: number }
}) => ({
  uploadUrl: 'https://upload.example.com/presigned',
  uploadId: 'upload-id',
  requiredHeaders: { 'If-None-Match': '*' },
})
const finalizeUpload = async (_input: {
  data: { portalId: string; uploadId: string }
}) => ({
  heroImageUrl: 'https://cdn.example.com/hero.png',
  processing: false,
})

const idleMutation = Object.assign(
  async (_input: UpdatePortalVariables) => ({ success: true }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<UpdatePortalVariables, { success: boolean }>

const idleReviewMutation = Object.assign(
  async (_input: CompleteReviewVariables) => ({ status: 'recorded' as const }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<CompleteReviewVariables, CompleteReviewResult>

const baseArgs = {
  portal,
  googleReviewDestination: {
    state: 'verified' as const,
    retrievedAt: '2026-08-20T10:00:00.000Z',
  },
  publicationHistory: {
    current: {
      activationSequence: 1,
      version: 1,
      kind: 'publish' as const,
      activatedAt: '2026-08-20T10:00:00.000Z',
      deactivatedAt: null,
      deactivationReason: null,
    },
    priorActivations: [],
    hasPendingChanges: false,
    nextCursor: null,
  },
  mutation: idleMutation,
  completeReviewMutation: idleReviewMutation,
  theme: portal.theme,
  onThemeChange: fn(),
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
    const reviewPurpose = canvas.getByText(/review the saved gateway details/i)
    await expect(reviewPurpose).toHaveTextContent(
      /save pending edits before recording the review/i,
    )
    await expect(canvas.queryByText(/badges|leaderboards/i)).toBeNull()
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

// A saved colour that matches no preset must resolve to "Custom", not to a
// hardcoded "Light" whose button would silently overwrite it on the next click.
// Selection is exposed through aria-pressed, not colour alone.
export const CustomThemeResolvesToCustom: Story = {
  args: { ...baseArgs, theme: { primaryColor: '#0ea5e9' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /custom/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(canvas.getByRole('button', { name: /^light/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  },
}

// Selecting Dark transmits the whole palette, not just the primary colour.
export const DarkPresetSendsFullPalette: Story = {
  args: { ...baseArgs, onThemeChange: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^dark/i }))
    await waitFor(() =>
      expect(args.onThemeChange).toHaveBeenCalledWith({
        primaryColor: '#a5b4fc',
        backgroundColor: '#111827',
        textColor: '#f9fafb',
      }),
    )
  },
}

// The governed content-review fact needs an explicit attestation, and is sent
// as revision 1 with a fresh reviewId.
export const ContentReviewRecorded: Story = {
  args: {
    ...baseArgs,
    completeReviewMutation: Object.assign(
      fn(async (_input: CompleteReviewVariables) => ({ status: 'recorded' as const })),
      { isPending: false, error: null as unknown, isSuccess: false, data: null },
    ) as unknown as Action<CompleteReviewVariables, CompleteReviewResult>,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const record = canvas.getByRole('button', { name: /record content review/i })
    await expect(record).toBeDisabled()
    await userEvent.click(
      canvas.getByRole('checkbox', { name: /opened every destination/i }),
    )
    await waitFor(() => expect(record).toBeEnabled())
    await userEvent.click(record)
    await waitFor(() =>
      expect(args.completeReviewMutation).toHaveBeenCalledWith({
        data: { portalId: 'p-1', reviewId: expect.any(String), revision: 1 },
      }),
    )
  },
}

// The use case rejects review completion for unpublished content, so the UI
// never offers it.
export const ContentReviewNeedsPublished: Story = {
  args: { ...baseArgs, portal: { ...portal, publicationState: 'draft' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.queryByRole('button', { name: /record content review/i }),
    ).toBeNull()
    await expect(canvas.getByText(/publish this portal before recording/i)).toBeVisible()
  },
}
