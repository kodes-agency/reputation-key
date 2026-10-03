// Storybook stories for the shared FormErrorBanner primitive.
// FormErrorBanner surfaces a form mutation's top-level error inside a shadcn
// destructive Alert. It prints what a toast would: the server's own sentence for
// a 4xx refusal (TanStack Start re-throws a ServerFunctionError with its `code`
// and `status`), the issue list of a rejected schema, a sentence a dialog holds
// as text, and one generic sentence for anything else, so a 5xx or an untagged
// error never shows text that was not written for a reader. A falsy value
// renders nothing.
//
// Stories feed it the realistic shapes a mutation surfaces: no error, a field
// validation refusal, a permission refusal, an internal server error and a
// non-Error object (both of which read as the generic sentence).
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import { GENERIC_ACTION_ERROR_MESSAGE } from '#/components/hooks/use-action-mutation'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
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

// A domain refusal the context wrote for the person who pressed the button: a
// 4xx ServerFunctionError, so its sentence is shown as written.
export const ValidationError: Story = {
  args: {
    error: new ServerFunctionError(
      'ValidationError',
      'Name must be at least 2 characters',
      'invalid_name',
      400,
    ),
  },
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
  args: {
    error: new ServerFunctionError(
      'AuthError',
      'You do not have permission to perform this action',
      'permission_denied',
      403,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      await canvas.findByText(/you do not have permission to perform this action/i),
    ).toBeInTheDocument()
  },
}

// A rejected `.validator` schema reaches the client as a plain Error whose message
// is the issue list; it is shown as lines, not as JSON.
export const SchemaIssues: Story = {
  args: {
    error: new Error(
      JSON.stringify([
        { path: ['name'], message: 'Too short' },
        { path: ['slug'], message: 'Use letters only' },
      ]),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText('name: Too short')).toBeInTheDocument()
    expect(canvas.getByText('slug: Use letters only')).toBeInTheDocument()
  },
}

// An internal server error (catchUntagged masks the real cause as a 500): the
// banner says the generic sentence and never the server's own text.
export const GenericServerError: Story = {
  args: {
    error: new ServerFunctionError(
      'InternalError',
      'Internal server error',
      'internal_error',
      500,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(GENERIC_ACTION_ERROR_MESSAGE)).toBeInTheDocument()
    expect(canvas.queryByText(/internal server error/i)).toBeNull()
  },
}

// A plain Error that is not a server-function error (a dropped connection, a
// bug) may carry text that names internal state, so it reads as the generic
// sentence too.
export const UntaggedError: Story = {
  args: { error: new Error('ECONNRESET at db-primary.internal:5432') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(GENERIC_ACTION_ERROR_MESSAGE)).toBeInTheDocument()
    expect(canvas.queryByText(/ECONNRESET/)).toBeNull()
  },
}

// Non-Error object with a `message` key — an upstream layer handed the form a
// plain object instead of an Error; its text is not shown either.
export const ObjectShapedError: Story = {
  args: { error: { message: 'The selected item is no longer available' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(await canvas.findByText(GENERIC_ACTION_ERROR_MESSAGE)).toBeInTheDocument()
    expect(canvas.queryByText(/no longer available/i)).toBeNull()
  },
}

// A sentence a dialog already holds (an upload refusal) is handed in as text.
export const SentenceAsText: Story = {
  args: { error: 'Use a JPEG, PNG or WebP photo.' },
  play: async ({ canvasElement }) => {
    expect(
      await within(canvasElement).findByText('Use a JPEG, PNG or WebP photo.'),
    ).toBeInTheDocument()
  },
}

// Where it goes: a form's refusal sits directly above that form's actions (the
// end of a card's body, above its footer), so it is next to the button that was
// pressed and cannot scroll out of sight on a long card. A row or immediate
// action does not use it: that is a toast.
export const AboveTheActions: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Business profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Fields of the form sit here.</p>
        <FormErrorBanner
          error={
            new ServerFunctionError(
              'ConflictError',
              'That workspace name is already in use.',
              'name_taken',
              409,
            )
          }
        />
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button type="submit">Save profile</Button>
      </CardFooter>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole('alert')
    const save = within(canvasElement).getByRole('button', { name: 'Save profile' })
    expect(alert).toHaveTextContent('That workspace name is already in use.')
    // The banner comes before the button in the document, with nothing between
    // them but the card's footer.
    expect(
      alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(alert.closest('[data-slot="card-content"]')?.nextElementSibling).toBe(
      save.closest('[data-slot="card-footer"]'),
    )
  },
}

export const AboveTheActionsLight: Story = {
  ...AboveTheActions,
  parameters: { layout: 'padded', theme: 'light' },
}
