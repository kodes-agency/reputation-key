import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from 'storybook/test'
import { ReviewReplyPublishedEditor } from './reply-editor-views'
import { withRole } from '../../../.storybook/AuthedRouterDecorator'

const onSave = fn(async (_text: string) => undefined)
const onCancel = fn(() => {})

const meta: Meta<typeof ReviewReplyPublishedEditor> = {
  title: 'Inbox/ReplyEditorViews',
  component: ReviewReplyPublishedEditor,
  decorators: [withRole('PropertyManager')],
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof ReviewReplyPublishedEditor>

export const PublishedEditRequiresConfirmation: Story = {
  args: {
    reply: {
      text: 'Thank you for your feedback. We hope to welcome you again.',
      publishedAt: new Date('2026-08-27T08:00:00.000Z'),
      rejectionReason: null,
    },
    isSaving: false,
    onSave,
    onCancel,
  },
  play: async ({ canvasElement }) => {
    onSave.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /review update/i }))
    const dialog = within(document.body).getByRole('alertdialog')
    expect(
      within(dialog).getByText(/keeps the update pending until google confirms/i),
    ).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.click(
      within(dialog).getByRole('button', { name: /confirm & update/i }),
    )
    expect(onSave).toHaveBeenCalledWith(
      'Thank you for your feedback. We hope to welcome you again.',
    )
  },
}
