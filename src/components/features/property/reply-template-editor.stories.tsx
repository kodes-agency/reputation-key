import type { Meta, StoryObj } from '@storybook/react-vite'
import { userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { ReplyTemplateEditor } from './reply-template-editor'
import { replyLibraryFixture, storyAction } from './reply-library.stories.fixtures'

const library = replyLibraryFixture()

const meta = {
  title: 'Property/Settings/Reply template editor',
  component: ReplyTemplateEditor,
  parameters: { layout: 'centered' },
  args: {
    propertyId: '10000000-0000-4000-8000-000000000101',
    propertyName: 'Harbor Hotel',
    propertyCount: 2,
    library,
    template: library.templates[0]!,
    action: storyAction(library),
    trigger: <Button type="button">Open editor</Button>,
  },
} satisfies Meta<typeof ReplyTemplateEditor>

export default meta
type Story = StoryObj<typeof meta>

async function open(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: 'Open editor' }),
  )
}

async function replaceReplyBody(canvasElement: HTMLElement, text: string) {
  await open(canvasElement)
  const body = within(canvasElement.ownerDocument.body)
  const textarea = await body.findByRole('textbox', { name: 'Reply body' })
  await userEvent.clear(textarea)
  await userEvent.type(textarea, text)
}

export const Clean: Story = { play: ({ canvasElement }) => open(canvasElement) }

/** "Add template" opens an empty editor; it once re-rendered forever (2026-10-30). */
export const AddTemplate: Story = {
  args: { template: null, trigger: <Button type="button">Open editor</Button> },
  play: async ({ canvasElement }) => {
    await open(canvasElement)
    await within(canvasElement.ownerDocument.body).findByRole('textbox', {
      name: 'Reply body',
    })
  },
}

export const WithBlocks: Story = {
  play: ({ canvasElement }) => replaceReplyBody(canvasElement, 'Book now for 20% off.'),
}

export const WithWarnings: Story = {
  play: ({ canvasElement }) =>
    replaceReplyBody(
      canvasElement,
      'We are thrilled that your feedback is important to us.',
    ),
}
