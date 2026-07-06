// Storybook stories for the shared SubmitButton form primitive.
// Covers idle, pending (mutation.isPending → spinner + disabled + aria-busy),
// form-invalid (form.state.canSubmit=false → disabled), and the variant prop.

import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { SubmitButton } from './submit-button'

const meta: Meta<typeof SubmitButton> = {
  title: 'Forms/SubmitButton',
  component: SubmitButton,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof SubmitButton>

// Shared submit handler so the Default play fn can assert a click actually
// fires the surrounding form's submit (a bare type="submit" button outside a
// <form> would do nothing observable).
const onSubmit = fn((e: React.FormEvent) => e.preventDefault())

function FormWrap({ children }: { children: React.ReactNode }) {
  return <form onSubmit={onSubmit}>{children}</form>
}

export const Default: Story = {
  args: {
    mutation: { isPending: false, error: null },
    children: 'Save changes',
  },
  render: (args) => (
    <FormWrap>
      <SubmitButton {...args} />
    </FormWrap>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /save changes/i })
    await expect(button).toBeEnabled()
    await expect(button).toHaveAttribute('type', 'submit')
    await expect(button).not.toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    await expect(onSubmit).toHaveBeenCalled()
  },
}

export const Pending: Story = {
  args: {
    mutation: { isPending: true, error: null },
    children: 'Saving…',
  },
  render: (args) => (
    <FormWrap>
      <SubmitButton {...args} />
    </FormWrap>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /saving/i })
    // isPending forces disabled + aria-busy; a click must NOT fire submit.
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    // spinner icon is rendered (Loader2 is an svg)
    await expect(button.querySelector('svg')).toBeInTheDocument()
  },
}

export const FormInvalid: Story = {
  args: {
    mutation: { isPending: false, error: null },
    form: { state: { canSubmit: false, isSubmitting: false } },
    children: 'Save changes',
  },
  render: (args) => (
    <FormWrap>
      <SubmitButton {...args} />
    </FormWrap>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /save changes/i })).toBeDisabled()
  },
}

export const Destructive: Story = {
  args: {
    mutation: { isPending: false, error: null },
    variant: 'destructive',
    children: 'Delete account',
  },
  render: (args) => (
    <FormWrap>
      <SubmitButton {...args} />
    </FormWrap>
  ),
}

export const Secondary: Story = {
  args: {
    mutation: { isPending: false, error: null },
    variant: 'secondary',
    children: 'Cancel',
  },
  render: (args) => (
    <FormWrap>
      <SubmitButton {...args} />
    </FormWrap>
  ),
}

export const Outline: Story = {
  args: {
    mutation: { isPending: false, error: null },
    variant: 'outline',
    children: 'Save draft',
  },
  render: (args) => (
    <FormWrap>
      <SubmitButton {...args} />
    </FormWrap>
  ),
}
