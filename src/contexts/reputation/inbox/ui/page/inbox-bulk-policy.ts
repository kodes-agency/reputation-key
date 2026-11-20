import type { InboxItem } from '#/contexts/inbox/application/public-api'

export type BulkReopenCommand = Readonly<{
  inboxItemId: string
  expectedCommandRevision: number
}>

type BulkReopenResult = Readonly<{
  updated: number
  results: ReadonlyArray<unknown>
}>

export const buildBulkReopenCommands = (
  selectedIds: ReadonlyArray<string>,
  items: ReadonlyArray<InboxItem>,
): BulkReopenCommand[] => {
  const byId = new Map<string, InboxItem>(items.map((item) => [item.id, item]))
  return selectedIds.flatMap((id) => {
    const item = byId.get(id)
    return item
      ? [{ inboxItemId: item.id, expectedCommandRevision: item.commandRevision }]
      : []
  })
}

export const bulkReopenNotice = (
  result: BulkReopenResult,
): Readonly<{ tone: 'success' | 'info'; message: string }> => {
  const notReopened = result.results.length - result.updated
  if (notReopened === 0) {
    return {
      tone: 'success',
      message: `${result.updated} ${result.updated === 1 ? 'item' : 'items'} reopened`,
    }
  }
  if (result.updated > 0) {
    return {
      tone: 'info',
      message: `${result.updated} reopened; ${notReopened} changed or unavailable. The list was refreshed.`,
    }
  }
  return {
    tone: 'info',
    message: 'No items were reopened. The list was refreshed with current state.',
  }
}
