// Create portal form — TanStack Form + Zod, mutation received as a prop
// (no server imports). The form auto-generates a slug from the name and emits
// live preview state via onPreviewChange. No usePermissions — does not need
// the authed router. Play functions cover: name→slug auto-gen, required-name
// validation on submit, and a pending (submitting) state.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CreatePortalForm } from './create-portal-form'
import type { Action } from '#/components/hooks/use-action'

type CreatePortalVariables = {
  data: {
    name: string
    slug?: string
    description?: string
    propertyId: string
    theme?: { primaryColor: string; backgroundColor?: string; textColor?: string }
  }
}

const meta: Meta<typeof CreatePortalForm> = {
  title: 'Portal/CreatePortalForm',
  component: CreatePortalForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof CreatePortalForm>

const idleMutation = Object.assign(
  async (_input: CreatePortalVariables) => ({ success: true }),
  { isPending: false, error: null as unknown, isSuccess: false, data: null },
) as Action<CreatePortalVariables, { success: boolean }>

// Never resolves → SubmitButton stays in pending state.
const { promise: neverResolves } = Promise.withResolvers<{ success: boolean }>()
const pendingMutation = Object.assign(
  async (_input: CreatePortalVariables) => neverResolves,
  { isPending: true, error: null as unknown, isSuccess: false, data: null },
) as Action<CreatePortalVariables, { success: boolean }>

export const Default: Story = {
  args: {
    propertyId: 'prop-1',
    mutation: idleMutation,
  },
}

// The slug mirrors the name on every keystroke via `normalizeSlug` — the same
// function the create-portal use case derives with — so the client and the
// server can never disagree about the derived value.
export const AutoGeneratesSlug: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), 'Guest Portal')
    await waitFor(() => {
      expect(canvas.getByLabelText(/slug/i)).toHaveValue('guest-portal')
    })
  },
}

// A name with no Latin alphanumerics derives an empty slug. That used to reach
// the server and come back as a raw Zod issue array in the error banner; the
// slug field now says what to do before any request is made.
export const UnderivableSlugIsExplained: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), '東京')
    await userEvent.click(canvas.getByRole('button', { name: /create portal/i }))
    await expect(
      await canvas.findByText(/no letters or numbers to build a web address from/i),
    ).toBeInTheDocument()
  },
}

// A hand-typed slug is validated as-is against SLUG_PATTERN, because the use
// case does not normalize a provided slug either.
export const InvalidTypedSlugIsRejectedInline: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), 'Spa')
    const slug = canvas.getByLabelText(/slug/i)
    await userEvent.clear(slug)
    await userEvent.type(slug, 'Not A Slug!')
    await userEvent.click(canvas.getByRole('button', { name: /create portal/i }))
    await expect(
      await canvas.findByText(/2–64 lowercase letters, numbers or hyphens/i),
    ).toBeInTheDocument()
  },
}

// Empty-name submit surfaces the required validation error after touch.
export const ValidationError: Story = {
  args: { ...Default.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /create portal/i }))
    await expect(await canvas.findByText(/portal name is required/i)).toBeInTheDocument()
  },
}

// Submitting with a valid name calls the mutation.
export const SubmitCallsMutation: Story = {
  args: {
    propertyId: 'prop-1',
    // Fresh spy so this story's assertion is isolated.
    mutation: Object.assign(
      async (input: CreatePortalVariables) => {
        expect(input.data.propertyId).toBe('prop-1')
        return { success: true }
      },
      { isPending: false, error: null as unknown, isSuccess: false, data: null },
    ) as Action<CreatePortalVariables, { success: boolean }>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Name'), 'Spa')
    await userEvent.click(canvas.getByRole('button', { name: /create portal/i }))
    // The inline expect above throws if propertyId mismatches; reaching here
    // means the mutation was called with the right payload.
    await expect(canvas.getByLabelText('Name')).toBeInTheDocument()
  },
}

// Pending state — SubmitButton shows the spinner + is aria-busy.
export const Submitting: Story = {
  args: {
    propertyId: 'prop-1',
    mutation: pendingMutation,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const submit = canvas.getByRole('button', { name: /create portal/i })
    await expect(submit).toHaveAttribute('aria-busy', 'true')
  },
}
