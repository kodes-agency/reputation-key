// In-memory PortalLastPrintRepository fake — for use in use case tests.

import type {
  PortalLastPrint,
  PortalLastPrintRepository,
  RecordPortalLastPrintInput,
} from '#/contexts/portal/application/ports/portal-last-print.repository'

export type InMemoryPortalLastPrintRepo = PortalLastPrintRepository &
  Readonly<{
    /** What each call to `record` was given, oldest first. */
    recorded: () => ReadonlyArray<RecordPortalLastPrintInput>
    /** Makes the next `record` fail, to prove a print is not lost with its memory. */
    failNextRecord: (error: Error) => void
  }>

const keyOf = (organizationId: string, portalId: string) =>
  `${organizationId}:${portalId}`

export const createInMemoryPortalLastPrintRepo = (
  seed: ReadonlyArray<RecordPortalLastPrintInput> = [],
): InMemoryPortalLastPrintRepo => {
  const store = new Map<string, PortalLastPrint>()
  const calls: RecordPortalLastPrintInput[] = []
  let pendingFailure: Error | null = null

  const write = (input: RecordPortalLastPrintInput): boolean => {
    const key = keyOf(input.organizationId, input.portalId)
    const existing = store.get(key)
    if (existing && existing.printedAt.getTime() > input.printedAt.getTime()) return false
    store.set(key, {
      printedAt: input.printedAt,
      settings: input.settings,
      photo: input.photo,
    })
    return true
  }
  for (const input of seed) write(input)

  return {
    record: async (input) => {
      if (pendingFailure) {
        const failure = pendingFailure
        pendingFailure = null
        throw failure
      }
      calls.push(input)
      return write(input)
    },
    find: async (organizationId, portalId) =>
      store.get(keyOf(organizationId, portalId)) ?? null,
    recorded: () => calls,
    failNextRecord: (error) => {
      pendingFailure = error
    },
  }
}
