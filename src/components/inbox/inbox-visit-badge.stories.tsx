// Inbox last-visit count badge — mounts in the global manager layout and fetches
// its own count via the getLastVisitCount server fn on mount. The component is
// non-critical: a zero/null count renders nothing, a load failure is swallowed.
// Stories drive the mock fn to hit each render branch.
import type { Meta, StoryObj } from '@storybook/react'
import { InboxVisitBadge } from './inbox-visit-badge'
import type { getLastVisitCountFn } from '#/contexts/inbox/server/inbox'
import { mockServerFn } from '../../../.storybook/mocks/mock-action'

// mockServerFn returns a plain callable; the prop type is `typeof getLastVisitCountFn`
// (carries createServerFn metadata the component never reads). The cast bridges
// that unexpressible server-fn brand — same pattern as inbox-bulk-actions.
const countFiveFn = mockServerFn(async () => 5) as unknown as typeof getLastVisitCountFn
const countManyFn = mockServerFn(async () => 150) as unknown as typeof getLastVisitCountFn
const countZeroFn = mockServerFn(async () => 0) as unknown as typeof getLastVisitCountFn

const meta: Meta<typeof InboxVisitBadge> = {
  title: 'Inbox/Visit Badge',
  component: InboxVisitBadge,
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof InboxVisitBadge>

export const Default: Story = {
  args: { getLastVisitCount: countFiveFn },
}

// 150 open since last visit → caps at "99+".
export const NinetyNinePlus: Story = {
  args: { getLastVisitCount: countManyFn },
}

// 0 open → the badge is intentionally absent (renders null).
export const HiddenWhenZero: Story = {
  args: { getLastVisitCount: countZeroFn },
}
