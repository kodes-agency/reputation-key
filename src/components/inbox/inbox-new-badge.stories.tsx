// Inbox new-count badge — mounts in the global manager layout and fetches its
// own count via the getNewCount server fn on mount. The component is
// non-critical: a zero/null count renders nothing, a load failure is swallowed.
// Stories drive the mock fn to hit each render branch.
import type { Meta, StoryObj } from '@storybook/react'
import { InboxNewBadge } from './inbox-new-badge'
import type { getNewCountFn } from '#/contexts/inbox/server/inbox'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'

// mockServerFn returns a plain callable; the prop type is `typeof getNewCountFn`
// (carries createServerFn metadata the component never reads). The cast bridges
// that unexpressible server-fn brand — same pattern as inbox-bulk-actions.
const countFiveFn = mockServerFn(async () => 5) as unknown as typeof getNewCountFn
const countManyFn = mockServerFn(async () => 150) as unknown as typeof getNewCountFn
const countZeroFn = mockServerFn(async () => 0) as unknown as typeof getNewCountFn

const meta: Meta<typeof InboxNewBadge> = {
  title: 'Inbox/New Badge',
  component: InboxNewBadge,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof InboxNewBadge>

// 5 unread → badge renders "5".
export const Default: Story = {
  args: { getNewCount: countFiveFn },
}

// 150 unread → caps at "99+".
export const NinetyNinePlus: Story = {
  args: { getNewCount: countManyFn },
}

// 0 unread → the badge is intentionally absent (renders null).
export const HiddenWhenZero: Story = {
  args: { getNewCount: countZeroFn },
}
