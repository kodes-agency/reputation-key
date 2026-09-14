import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { InboxQueueRail } from './inbox-queue-rail'
import { InboxShortcutsDialog } from './inbox-shortcuts-dialog'

const counts: InboxQueueCounts = {
  reply: 18,
  approval: 4,
  waiting: 2,
  feedback: 7,
  escalated: 3,
  mine: 5,
  closed: 42,
  open: 31,
}

function RailStory({ canManageReplies = true }: { canManageReplies?: boolean }) {
  const [queue, setQueue] = useState<InboxQueue>(canManageReplies ? 'reply' : 'open')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  return (
    <div className="h-[560px]">
      <InboxQueueRail
        queue={queue}
        counts={
          canManageReplies
            ? counts
            : { ...counts, reply: null, approval: null, waiting: null }
        }
        canManageReplies={canManageReplies}
        onQueueChange={setQueue}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <InboxShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}

const meta: Meta<typeof InboxQueueRail> = {
  title: 'Inbox/Queue Rail',
  component: InboxQueueRail,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof InboxQueueRail>

export const Manager: Story = { render: () => <RailStory /> }
export const Member: Story = { render: () => <RailStory canManageReplies={false} /> }
export const ZeroCounts: Story = {
  args: {
    queue: 'reply',
    counts: { ...counts, reply: 0, approval: 0, waiting: 0, feedback: 0 },
    canManageReplies: true,
    onQueueChange: () => undefined,
    onOpenShortcuts: () => undefined,
  },
  render: (args) => (
    <div className="h-[560px]">
      <InboxQueueRail {...args} />
    </div>
  ),
}
