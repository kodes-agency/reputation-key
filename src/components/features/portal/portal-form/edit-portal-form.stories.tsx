// Edit portal form — TanStack Form + Zod, mutation/uploaders as props.
// Uses usePermissions() (AccountAdmin → fields enabled; Staff → disabled), so
// it needs the AuthedRouterDecorator. The form has NO submit button in
// isolation — submission is driven by the parent's "Save Changes" button via
// formRef.current.handleSubmit(). Stories render a wrapper that owns the ref
// and exposes the same Save button, so play functions submit by clicking it.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { useRef, type ComponentProps } from 'react'
import { EditPortalForm } from './edit-portal-form'
import { Button } from '#/components/ui/button'
import type { Action } from '#/components/hooks/use-action'
import type { FormLike, PortalData, UpdatePortalVariables } from '../shared/types'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'

// Owns the formRef so stories never pass a ref object as an arg: the form
// assigns itself into the ref from an effect, and a ref in args becomes a
// circular structure Storybook cannot serialize ("cycle in arg" warnings).
// Mirrors the real parent (PortalSettings), which drives submission from an
// external Save button via the ref.
function EditPortalFormWithSave(
  props: Omit<ComponentProps<typeof EditPortalForm>, 'formRef'>,
) {
  const formRef = useRef<FormLike | null>(null)
  return (
    <div className="flex w-full flex-col gap-4">
      <EditPortalForm {...props} formRef={formRef} />
      <Button
        type="button"
        onClick={() => formRef.current?.handleSubmit()}
        disabled={props.mutation.isPending}
      >
        {props.mutation.isPending ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  )
}

const meta: Meta<typeof EditPortalForm> = {
  title: 'Portal/EditPortalForm',
  component: EditPortalForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
  render: (args) => <EditPortalFormWithSave {...args} />,
}
export default meta
type Story = StoryObj<typeof EditPortalForm>

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
}) => ({ uploadUrl: 'https://upload.example.com/presigned', uploadId: 'upload-id' })
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

const submitSpy = fn(async (_input: UpdatePortalVariables) => ({ success: true }))

// Pre-filled from portal data — the canonical edit state.
export const Default: Story = {
  args: {
    portal,
    mutation: idleMutation,
    theme: portal.theme,
    requestUploadUrl,
    finalizeUpload,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Name is pre-filled from portal data.
    await expect(canvas.getByLabelText('Name')).toHaveValue('Guest Services')
    // Basic Info section heading renders.
    await expect(canvas.getByText('Basic Info')).toBeInTheDocument()
  },
}

// The slug is read-only until the manager asks to change it; changing it warns
// that spelled-out URLs break while token-based printed links keep resolving.
export const SlugGuardedChange: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Read-only by default: the value is rendered, but not as a text input.
    await expect(canvas.getByText('guest-services')).toBeInTheDocument()
    await expect(canvas.queryByRole('textbox', { name: /url slug/i })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /change slug/i }))
    const slug = canvas.getByRole('textbox', { name: /url slug/i })
    await userEvent.clear(slug)
    await userEvent.type(slug, 'front-desk')
    await expect(await canvas.findByText(/resolve by token, not by slug/i)).toBeVisible()
  },
}

// Clearing the required name + submitting surfaces field validation.
export const ValidationError: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.clear(canvas.getByLabelText('Name'))
    // Drive submit via the Save button (no SubmitButton in isolation).
    await userEvent.click(canvas.getByRole('button', { name: /save changes/i }))
    // isTouched && !isValid → input flagged aria-invalid.
    await waitFor(() =>
      expect(canvas.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true'),
    )
  },
}

// Valid submit calls the mutation with the portal's payload.
export const SubmitCallsMutation: Story = {
  args: {
    ...Default.args,
    mutation: Object.assign(submitSpy, {
      isPending: false,
      error: null as unknown,
      isSuccess: false,
      data: null,
    }) as unknown as Action<UpdatePortalVariables, { success: boolean }>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(submitSpy).toHaveBeenCalled())
  },
}

// Save in flight — mutation.isPending is the signal the Save button reads.
export const Saving: Story = {
  args: {
    ...Default.args,
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
    const save = canvas.getByRole('button', { name: /saving/i })
    await expect(save).toBeDisabled()
  },
}

// Staff role — fields disabled (can('portal.update') is false).
export const StaffDisabled: Story = {
  args: { ...Default.args },
  decorators: [withRole('Staff')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).toBeDisabled()
  },
}
