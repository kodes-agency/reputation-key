// Demonstrates the in-memory container running the REAL getInboxItems use-case.
// Seeds 5 items, then computes three counts via the actual use-case — proving
// stories exercise domain logic, not canned mocks.
//
// Fixture note (#135 drift, caught by the play below): the status redesign
// collapsed new/read/addressed/archived/escalated to open|closed + an
// `isEscalated` flag, and mechanically rewrote this seed so ALL FIVE items were
// `open` — while the verdict below still compared the second bucket to 3. The ✗
// branch had been rendering ever since, silently, because no play looked. The
// three buckets are now all|open|escalated with three DISTINCT counts (5/4/2),
// so each filter has to actually filter: a status predicate that returns
// everything shows 5, not 4. Item 5 is closed-but-still-flagged — the
// orthogonality #135 introduced (see the InboxItem.isEscalated doc comment).
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { expect, within } from 'storybook/test'
import {
  createInboxContainer,
  makeInboxItem,
  inboxTestIds,
} from '../../../.storybook/in-memory/inbox-container'
import type { AuthContext } from '#/shared/domain/auth-context'

type Counts = { all: number; open: number; escalated: number }

function InboxRealLogic() {
  const [counts, setCounts] = useState<Counts | null>(null)

  useEffect(() => {
    const container = createInboxContainer()
    container.seed([
      makeInboxItem({ id: '1', sourceType: 'review', status: 'open' }),
      makeInboxItem({ id: '2', sourceType: 'review', status: 'open' }),
      makeInboxItem({ id: '3', sourceType: 'feedback', status: 'open' }),
      makeInboxItem({ id: '4', sourceType: 'review', status: 'open', isEscalated: true }),
      makeInboxItem({
        id: '5',
        sourceType: 'feedback',
        status: 'closed',
        isEscalated: true,
      }),
    ])
    const { ORG, USER, role } = inboxTestIds
    const ctx = { organizationId: ORG, userId: USER, role } as AuthContext
    void Promise.all([
      container.inboxPublicApi.getInboxItems(
        {
          filters: {},
        },
        ctx,
      ),
      container.inboxPublicApi.getInboxItems(
        {
          filters: { status: 'open' },
        },
        ctx,
      ),
      container.inboxPublicApi.getInboxItems(
        {
          filters: { isEscalated: true },
        },
        ctx,
      ),
    ]).then(([all, onlyOpen, onlyEscalated]) => {
      setCounts({
        all: all.items.length,
        open: onlyOpen.items.length,
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
        Seeded 5 items into the in-memory repo (4 open, 2 escalated — one of the escalated
        pair is already closed).
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        <li>
          All items: <strong>{counts.all}</strong>
        </li>
        <li>
          Open: <strong>{counts.open}</strong>
        </li>
        <li>
          Escalated: <strong>{counts.escalated}</strong>
        </li>
      </ul>
      {counts.all === 5 && counts.open === 4 && counts.escalated === 2 ? (
        <p className="text-sm font-medium text-emerald-500">
          ✓ Real use-case computed the expected counts (5 / 4 / 2)
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

// The component computes a verdict and renders ✓ or ✗. Without a play the ✗
// branch is a PASSING test — a computed verdict, discarded. This play makes the
// verdict load-bearing, on three independent levels:
//
//  1. The counts themselves. This is the discriminating assertion: it re-states
//     the use-case's expected output (5 / 4 / 2) in the test, so it holds even
//     if the component's own ✓/✗ comparison is wrong or its copy is reworded.
//  2. The ✓ line is present — which also proves the component AGREES with (1).
//  3. The ✗ line is absent. Ordered after (1)/(2) on purpose: while the
//     use-case is still resolving neither line is rendered, so an absence
//     assertion on its own would be vacuous. Together with (2) it means a
//     reworded ✓ string can never silently make this play stop discriminating —
//     one of the two assertions must then fail.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // findAllBy* waits out the three awaited getInboxItems reads.
    const rows = await canvas.findAllByRole('listitem')
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'All items: 5',
      'Open: 4',
      'Escalated: 2',
    ])

    await expect(
      canvas.getByText('✓ Real use-case computed the expected counts (5 / 4 / 2)'),
    ).toBeVisible()
    expect(canvas.queryByText(/Counts mismatch/)).toBeNull()
  },
}
