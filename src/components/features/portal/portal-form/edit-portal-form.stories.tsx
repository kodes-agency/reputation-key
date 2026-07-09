// Edit portal form — TanStack Form + Zod, mutation/uploaders as props.
// Uses usePermissions() (AccountAdmin → fields enabled; Staff → disabled), so
// it needs the AuthedRouterDecorator. The form has NO submit button in
// isolation — submission is driven by the parent's "Save Changes" button via
// formRef.current.handleSubmit(). Stories pass a formRef and trigger it in the
// play function.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import { EditPortalForm } from './edit-portal-form'
import type { Action } from '#/components/hooks/use-action'
import type { PortalData, UpdatePortalVariables } from '../shared/types'
import {
  AuthedRouterDecorator,
  withRole,
} from '../../../../../.storybook/AuthedRouterDecorator'

const meta: Meta<typeof EditPortalForm> = {
  title: 'Portal/EditPortalForm',
  component: EditPortalForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  decorators: [AuthedRouterDecorator],
}
export default meta
type Story = StoryObj<typeof EditPortalForm>

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

// Module-level refs/spies so play functions can read them without casting args.
const defaultFormRef: FormRef = { current: null }
const validationFormRef: FormRef = { current: null }
const submitFormRef: FormRef = { current: null }
const submitSpy = fn(async (_input: UpdatePortalVariables) => ({ success: true }))

// Pre-filled from portal data — the canonical edit state.
export const Default: Story = {
  args: {
    portal,
    mutation: idleMutation,
    formRef: defaultFormRef,
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

// Clearing the required name + submitting surfaces field validation.
export const ValidationError: Story = {
  args: {
    ...Default.args,
    formRef: validationFormRef,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.clear(canvas.getByLabelText('Name'))
    // Drive submit via the formRef (no SubmitButton in isolation).
    validationFormRef.current?.handleSubmit()
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
    formRef: submitFormRef,
  },
  play: async () => {
    submitFormRef.current?.handleSubmit()
    await waitFor(() => expect(submitSpy).toHaveBeenCalled())
  },
}

// Save in flight — mutation.isPending is the signal the parent Save button reads.
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
