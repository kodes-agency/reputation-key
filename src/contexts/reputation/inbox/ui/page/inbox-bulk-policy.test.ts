import { describe, expect, it } from 'vitest'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { buildBulkReopenCommands, bulkReopenNotice } from './inbox-bulk-policy'

const item = (id: string, commandRevision: number) =>
  ({ id, commandRevision }) as InboxItem

describe('Inbox bulk reopen policy', () => {
  it('submits the exact client-observed revision in selection order', () => {
    const first = item('first', 3)
    const second = item('second', 8)

    expect(
      buildBulkReopenCommands(['second', 'missing', 'first'], [first, second]),
    ).toEqual([
      { inboxItemId: second.id, expectedCommandRevision: 8 },
      { inboxItemId: first.id, expectedCommandRevision: 3 },
    ])
  })

  it('uses neutral language for partial and conflicting results', () => {
    expect(bulkReopenNotice({ updated: 1, results: [{}, {}] })).toEqual({
      tone: 'info',
      message: '1 reopened; 1 changed or unavailable. The list was refreshed.',
    })
    expect(bulkReopenNotice({ updated: 0, results: [{}] }).message).toBe(
      'No items were reopened. The list was refreshed with current state.',
    )
  })
})
