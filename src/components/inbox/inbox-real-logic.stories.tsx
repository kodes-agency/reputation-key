// Demonstrates the in-memory container running the REAL getInboxItems use-case.
// Seeds 5 items (3 new, 2 escalated), then computes counts via the actual
// use-case — proving stories exercise domain logic, not canned mocks.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import {
  createInboxContainer,
  makeInboxItem,
  inboxTestIds,
} from '../../../.storybook/in-memory/inbox-container'

type Counts = { all: number; new: number; escalated: number }

function InboxRealLogic() {
  const [counts, setCounts] = useState<Counts | null>(null)

  useEffect(() => {
    const container = createInboxContainer()
    container.seed([
      makeInboxItem({ id: '1', sourceType: 'review', status: 'new' }),
      makeInboxItem({ id: '2', sourceType: 'review', status: 'new' }),
      makeInboxItem({ id: '3', sourceType: 'feedback', status: 'new' }),
      makeInboxItem({ id: '4', sourceType: 'review', status: 'escalated' }),
      makeInboxItem({ id: '5', sourceType: 'feedback', status: 'escalated' }),
    ])
    const { ORG, USER, role } = inboxTestIds
    void Promise.all([
      container.useCases.getInboxItems({
        organizationId: ORG,
        userId: USER,
        role,
        filters: {},
      }),
      container.useCases.getInboxItems({
        organizationId: ORG,
        userId: USER,
        role,
        filters: { status: 'new' },
      }),
      container.useCases.getInboxItems({
        organizationId: ORG,
        userId: USER,
        role,
        filters: { status: 'escalated' },
      }),
    ]).then(([all, onlyNew, onlyEscalated]) => {
      setCounts({
        all: all.items.length,
        new: onlyNew.items.length,
        escalated: onlyEscalated.items.length,
      })
    })
  }, [])

  if (!counts) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Computing via real getInboxItems use-case…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-6">
      <h2 className="text-lg font-semibold">
        Inbox counts — computed by the real use-case
      </h2>
      <p className="text-sm text-muted-foreground">
        Seeded 5 items into the in-memory repo (3 new, 2 escalated).
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        <li>
          All items: <strong>{counts.all}</strong>
        </li>
        <li>
          New: <strong>{counts.new}</strong>
        </li>
        <li>
          Escalated: <strong>{counts.escalated}</strong>
        </li>
      </ul>
      {counts.all === 5 && counts.new === 3 && counts.escalated === 2 ? (
        <p className="text-sm font-medium text-emerald-500">
          ✓ Real use-case computed the expected counts (5 / 3 / 2)
        </p>
      ) : (
        <p className="text-sm font-medium text-destructive">✗ Counts mismatch</p>
      )}
    </div>
  )
}

const meta: Meta<typeof InboxRealLogic> = {
  title: 'Inbox/Real Logic (In-Memory)',
  component: InboxRealLogic,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof InboxRealLogic>

export const Default: Story = {}
