// What the History tab's parts share: the Portal they show, the clock, what the
// viewer may do, what is open and the one write. The ledger, the Versions rail,
// the version dialog and the confirmations read it here instead of being handed
// it; each reads and awaits only its own data (`use-portal-history-reads.ts`).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Action } from '#/components/hooks/use-action'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import type {
  getPortalHistory,
  getPortalPublicationHistory,
} from '#/contexts/portal/server/portals'
import type {
  getPortalVersion,
  getPortalVersionPreview,
  getPortalVersions,
} from '#/contexts/portal/server/portal-versions'
import { useNow } from '#/components/features/portal/shared/use-now'
import type { HistoryFilterKey } from './portal-history-rows'

/** The reads, handed in by the route (components never import server modules). */
export type PortalHistoryReads = Readonly<{
  getHistory: typeof getPortalHistory
  getVersions: typeof getPortalVersions
  getVersion: typeof getPortalVersion
  /** The publication history, for the count of changes the draft holds. */
  getPublicationHistory: typeof getPortalPublicationHistory
  /** One version's guest page, for "View". Absent: the dialog draws the words alone. */
  getVersionPreview?: typeof getPortalVersionPreview
}>

export type MakeVersionLiveAction = Action<
  { data: { portalId: string; version: number } },
  unknown
>

/** What is open: a version seen in a dialog, or the choice to make it live again, on its line or in a dialog. */
export type HistorySelection = Readonly<{
  version: number
  mode: 'view' | 'restore'
  host: 'row' | 'dialog'
}>

type PortalHistoryValue = Readonly<{
  portalId: string
  portalName: string
  now: Date
  /** The property's IANA zone: its days are what "yesterday" means. */
  timeZone: string
  /** The viewer may make a version live again, and the page is on. */
  canMakeLive: boolean
  /** The page is on: only a live page has a version to switch. */
  pageIsLive: boolean
  reads: PortalHistoryReads
  filter: HistoryFilterKey
  showEarlier: boolean
  selection: HistorySelection | null
  /** The first version that "Show" revealed: its line takes focus. */
  revealedVersion: number | null
  /** The version just made live again: focus returns to its View, and a screen reader is told. */
  restoredVersion: number | null
  restoreError: string | null
  submitting: boolean
  changeFilter: (filter: HistoryFilterKey) => void
  select: (selection: HistorySelection | null) => void
  showEarlierVersions: (firstVersion: number) => void
  confirmRestore: (version: number) => Promise<void>
}>

const PortalHistoryContext = createContext<PortalHistoryValue | null>(null)

export function usePortalHistory(): PortalHistoryValue {
  const value = useContext(PortalHistoryContext)
  if (value === null) {
    throw new Error('The History tab’s parts are drawn inside PortalHistoryProvider.')
  }
  return value
}

type ProviderProps = Readonly<{
  portalId: string
  portalName: string
  timeZone: string
  /** The viewer holds `portal.update` and `portal.write`. */
  mayMakeLive: boolean
  pageIsLive: boolean
  reads: PortalHistoryReads
  makeLive: MakeVersionLiveAction
  /** A fixed clock, for a story or test; the tab reads the time itself. */
  now?: Date
  /** The state to open with, for a story or test. */
  initial?: Readonly<{ filter?: HistoryFilterKey; selection?: HistorySelection }>
  children: ReactNode
}>

export function PortalHistoryProvider({
  portalId,
  portalName,
  timeZone,
  mayMakeLive,
  pageIsLive,
  reads,
  makeLive,
  now: fixedNow,
  initial,
  children,
}: ProviderProps) {
  const clock = useNow()
  const [filter, setFilter] = useState<HistoryFilterKey>(initial?.filter ?? 'all')
  const [showEarlier, setShowEarlier] = useState(false)
  const [selection, setSelection] = useState<HistorySelection | null>(
    initial?.selection ?? null,
  )
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [revealedVersion, setRevealedVersion] = useState<number | null>(null)
  const [restoredVersion, setRestoredVersion] = useState<number | null>(null)

  const select = useCallback((next: HistorySelection | null) => {
    setRestoreError(null)
    setRestoredVersion(null)
    setSelection(next)
  }, [])
  const changeFilter = useCallback(
    (next: HistoryFilterKey) => {
      setFilter(next)
      setRevealedVersion(null)
      select(null)
    },
    [select],
  )
  const showEarlierVersions = useCallback((firstVersion: number) => {
    setRevealedVersion(firstVersion)
    setShowEarlier(true)
  }, [])
  const confirmRestore = useCallback(
    async (version: number) => {
      setRestoreError(null)
      try {
        await makeLive({ data: { portalId, version } })
        setRestoredVersion(version)
        setSelection(null)
      } catch (error) {
        setRestoreError(actionErrorMessage(error))
      }
    },
    [makeLive, portalId],
  )

  const value = useMemo<PortalHistoryValue>(
    () => ({
      portalId,
      portalName,
      now: fixedNow ?? clock,
      timeZone,
      canMakeLive: mayMakeLive && pageIsLive,
      pageIsLive,
      reads,
      filter,
      showEarlier,
      selection,
      revealedVersion,
      restoredVersion,
      restoreError,
      submitting: makeLive.isPending,
      changeFilter,
      select,
      showEarlierVersions,
      confirmRestore,
    }),
    [
      portalId,
      portalName,
      fixedNow,
      clock,
      timeZone,
      mayMakeLive,
      pageIsLive,
      reads,
      filter,
      showEarlier,
      selection,
      revealedVersion,
      restoredVersion,
      restoreError,
      makeLive.isPending,
      changeFilter,
      select,
      showEarlierVersions,
      confirmRestore,
    ],
  )
  return <PortalHistoryContext value={value}>{children}</PortalHistoryContext>
}
