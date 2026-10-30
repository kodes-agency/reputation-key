import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReplyVoiceCard } from './reply-voice-card'
import { replyLibraryFixture, storyAction } from './reply-library.stories.fixtures'

const library = replyLibraryFixture()

const meta = {
  title: 'Property/Settings/Reply voice card',
  component: ReplyVoiceCard,
  parameters: { layout: 'padded' },
  args: {
    propertyId: '10000000-0000-4000-8000-000000000101',
    propertyName: 'Harbor Hotel',
    propertyCount: 1,
    library,
    action: storyAction(library),
  },
} satisfies Meta<typeof ReplyVoiceCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ReadOnly: Story = {
  args: { library: replyLibraryFixture({ canManage: false }) },
}

export const MultiPropertyScope: Story = {
  args: { propertyCount: 3 },
}
