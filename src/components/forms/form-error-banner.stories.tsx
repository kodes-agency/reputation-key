// Storybook stories for the shared FormErrorBanner primitive.
// FormErrorBanner surfaces a form mutation's top-level error inside a shadcn
// destructive Alert. It accepts any `error`: an Error instance (TanStack Start
// re-throws serialized server Errors via seroval, preserving .message and any
// custom `code`/`status` props), a plain object with a `message` key, or a
// falsy value (renders nothing).
//
// Stories feed it the realistic shapes a mutation surfaces: no error, a Zod
// validation message, an auth/forbidden message, a generic server error, and a
// non-Error object (covers the object-message fallback branch).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { FormErrorBanner } from './form-error-banner'

const meta: Meta<typeof FormErrorBanner> = {
  title: 'Forms/FormErrorBanner',
  component: FormErrorBanner,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof FormErrorBanner>

// Falsy error → the component early-returns null (no Alert rendered).
export const NoError: Story = {
  args: { error: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('alert')).toBeNull()
  },
}

// A Zod validation rejection — the server throws an Error whose .message is the
// field-level validation reason (e.g. "slug must be URL-friendly").
export const ValidationError: Story = {
  args: { error: new Error('Name must be at least 2 characters') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/name must be at least 2 characters/i),
    ).toBeInTheDocument()
  },
}

// A tagged AuthError thrown by the context layer (throwContextError) — the
// .message carries the human-readable authorization reason.
export const AuthError: Story = {
  args: { error: new Error('You do not have permission to perform this action') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/you do not have permission to perform this action/i),
    ).toBeInTheDocument()
  },
}

// A generic/untagged server error surfaced via catchUntagged.
export const GenericServerError: Story = {
  args: { error: new Error('Something went wrong. Please try again.') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(/something went wrong/i)).toBeInTheDocument()
  },
}

// Non-Error object with a `message` key — exercises the fallback branch used
// when an upstream layer hands the form a plain object instead of an Error.
export const ObjectShapedError: Story = {
  args: { error: { message: 'The selected item is no longer available' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/the selected item is no longer available/i),
    ).toBeInTheDocument()
  },
}
