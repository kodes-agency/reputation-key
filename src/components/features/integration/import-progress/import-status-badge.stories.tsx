// Import status badge — one story per GbpImportJobStatus variant so each
// icon/label/badge-color combination is documented in isolation.
import type { Meta, StoryObj } from '@storybook/react'
import type { GbpImportJobStatus } from '#/contexts/integration/application/public-api'
import { ImportStatusBadge } from './import-status-badge'

const meta: Meta<typeof ImportStatusBadge> = {
  title: 'Integration/ImportStatusBadge',
  component: ImportStatusBadge,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof ImportStatusBadge>

const statusStory = (status: GbpImportJobStatus): Story => ({
  args: { status },
})

export const Queued: Story = statusStory('queued')
export const InProgress: Story = statusStory('in_progress')
export const Completed: Story = statusStory('completed')
export const CompletedWithSkips: Story = statusStory('completed_with_skips')
export const CompletedWithFailures: Story = statusStory('completed_with_failures')
export const Failed: Story = statusStory('failed')
