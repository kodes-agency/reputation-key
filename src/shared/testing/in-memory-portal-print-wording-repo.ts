// In-memory PortalPrintWordingRepository fake — for use in use case tests.

import type {
  PortalPrintWordingRepository,
  RecordPortalPrintWordingInput,
} from '#/contexts/portal/application/ports/portal-print-wording.repository'
import type { PrintFinalSavedWording } from '#/shared/domain/portal-print-final-wording'

export type InMemoryPortalPrintWordingRepo = PortalPrintWordingRepository &
  Readonly<{
    /** What each call to `save` was given, oldest first. */
    saved: () => ReadonlyArray<RecordPortalPrintWordingInput>
    /** Makes the next `save` fail, to prove a print is not lost with its memory. */
    failNextSave: (error: Error) => void
  }>

const keyOf = (organizationId: string, portalId: string) =>
  `${organizationId}:${portalId}`

type Stored = Readonly<{ wording: PrintFinalSavedWording; savedAt: Date }>

export const createInMemoryPortalPrintWordingRepo = (
  seed: ReadonlyArray<RecordPortalPrintWordingInput> = [],
): InMemoryPortalPrintWordingRepo => {
  const store = new Map<string, Stored>()
  const calls: RecordPortalPrintWordingInput[] = []
  let pendingFailure: Error | null = null

  const write = (input: RecordPortalPrintWordingInput): boolean => {
    const key = keyOf(input.organizationId, input.portalId)
    const existing = store.get(key)
    if (existing && existing.savedAt.getTime() > input.savedAt.getTime()) return false
    store.set(key, { wording: input.wording, savedAt: input.savedAt })
    return true
  }
  for (const input of seed) write(input)

  return {
    save: async (input) => {
      if (pendingFailure) {
        const failure = pendingFailure
        pendingFailure = null
        throw failure
      }
      calls.push(input)
      return write(input)
    },
    find: async (organizationId, portalId) =>
      store.get(keyOf(organizationId, portalId))?.wording ?? null,
    saved: () => calls,
    failNextSave: (error) => {
      pendingFailure = error
    },
  }
}
