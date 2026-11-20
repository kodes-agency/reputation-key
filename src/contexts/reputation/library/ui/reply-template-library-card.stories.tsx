import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReplyTemplateLibraryCard } from './reply-template-library-card'
import {
  replyLibraryFixture,
  storyAction,
  withTemplateStatus,
} from './reply-library.stories.fixtures'

const base = replyLibraryFixture()

const meta = {
  title: 'Property/Settings/Reply template library',
  component: ReplyTemplateLibraryCard,
  parameters: { layout: 'padded' },
  args: {
    propertyId: '10000000-0000-4000-8000-000000000101',
    propertyName: 'Harbor Hotel',
    propertyCount: 1,
    library: base,
    saveAction: storyAction(base),
    hideAction: storyAction(base),
    resetAction: storyAction(base),
  },
} satisfies Meta<typeof ReplyTemplateLibraryCard>

export default meta
type Story = StoryObj<typeof meta>

export const Essentials: Story = {}

export const HiddenAndCustomizedRows: Story = {
  args: {
    library: replyLibraryFixture({
      templates: base.templates.map((template, index) =>
        index === 0
          ? withTemplateStatus(template, 'customized')
          : index === 1
            ? withTemplateStatus(template, 'hidden')
            : template,
      ),
    }),
  },
}
