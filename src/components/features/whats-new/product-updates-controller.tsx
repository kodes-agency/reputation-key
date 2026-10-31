import type {
  ProductUpdatesClientGetter,
  ProductUpdatesView,
} from '#/shared/whats-new/types'
import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { productUpdatesQuery } from './queries'
import { planAutoOpen, productUpdatesSession, winOpening } from './auto-open'
import { selectModalUpdates } from './selection'
import { useMarkProductUpdatesSeen } from './use-product-update-actions'
import { useLeadingAiUpdate } from './use-leading-ai-update'
import { AiUpdateSection } from './ai-update-section'

const loadModal = () => import('./product-updates-modal')
const Modal = lazy(() => loadModal().then((m) => ({ default: m.ProductUpdatesModal })))
type Selection = ReturnType<typeof selectModalUpdates> & {
  propertyId: string | null
  aiUpdate: MerchantAiNoticeUpdate | null
}
type Props = Readonly<{
  userId: string
  organizationId: string
  getClient: ProductUpdatesClientGetter
}>

/** What the opening decides from, read again at every step: never the render it began in. */
type Latest = Readonly<{
  data: ProductUpdatesView | undefined
  aiUpdate: MerchantAiNoticeUpdate | null
  propertyId: string | null
  mounted: boolean
}>

function useLatest(value: Omit<Latest, 'mounted'>): RefObject<Latest> {
  const latest = useRef<Latest>({ ...value, mounted: true })
  useEffect(() => {
    latest.current = { ...value, mounted: true }
    return () => {
      latest.current = { ...latest.current, mounted: false }
    }
  })
  return latest
}

/** The terms the modal may open on now, and what it would show; null when it may not. */
function dueNow(latest: Latest, propertyId: string | null) {
  const { data, aiUpdate } = latest
  if (!latest.mounted || latest.propertyId !== propertyId || !data) return null
  const plan = planAutoOpen(data, aiUpdate !== null)
  if (!plan) return null
  const shown = selectModalUpdates(data, { hasLeadingItem: aiUpdate !== null })
  return { plan, selection: { ...shown, propertyId, aiUpdate } }
}

function useAutomaticOpening(
  { userId, organizationId, getClient }: Props,
  {
    propertyId,
    ready,
    latest,
    open,
  }: Readonly<{
    propertyId: string | null
    ready: boolean
    latest: RefObject<Latest>
    open: (value: Selection) => void
  }>,
) {
  useEffect(() => {
    if (!ready) return
    const conditions = () => ({
      shouldAutoOpen: dueNow(latest.current, propertyId) !== null,
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      dialogOpen: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
    })
    const claim = async () => {
      // Download before claiming, so waiting for code cannot open over another dialog.
      await loadModal()
      const due = dueNow(latest.current, propertyId)
      if (!due) return false
      return winOpening(due.plan, async () =>
        (await getClient()).claim({ data: { propertyId: propertyId ?? undefined } }),
      )
    }
    void productUpdatesSession
      .attempt(`${organizationId}:${userId}`, conditions, claim, () => {
        const due = dueNow(latest.current, propertyId)
        if (due) open(due.selection)
      })
      .catch(() => undefined)
  }, [userId, organizationId, getClient, propertyId, ready, latest, open])
}

function restoreFocus(target: HTMLElement | null) {
  if (target?.isConnected && target !== document.body) target.focus()
  else document.querySelector<HTMLElement>('[aria-label="Account menu"]')?.focus()
}

export default function ProductUpdatesController(props: Props) {
  const { userId, organizationId, getClient } = props
  const propertyId = usePropertyId()
  const query = useQuery(productUpdatesQuery(propertyId, getClient))
  const ai = useLeadingAiUpdate({ userId, organizationId }, getClient)
  const [selection, setSelection] = useState<Selection | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const markSeen = useMarkProductUpdatesSeen(
    selection?.propertyId ?? propertyId,
    getClient,
  )
  const open = useCallback((value: Selection) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(value)
  }, [])
  const latest = useLatest({ data: query.data, aiUpdate: ai.update, propertyId })
  // Both reads first: the one attempt of the session must know whether an AI update leads.
  const ready = query.data !== undefined && ai.settled
  useAutomaticOpening(props, { propertyId, ready, latest, open })
  if (!selection) return null
  const close = () => {
    const ids = [...selection.highlights, ...selection.fixes].map(({ id }) => id)
    if (ids.length > 0) void markSeen(ids).catch(() => undefined)
    // It was on screen, so it is seen: the banner goes with the shared entry.
    if (selection.aiUpdate) void ai.markSeen(selection.aiUpdate).catch(() => undefined)
    setSelection(null)
  }
  const { highlights, fixes, aiUpdate } = selection
  return (
    <Suspense fallback={null}>
      <Modal
        highlights={highlights}
        fixes={fixes}
        propertyId={selection.propertyId}
        leadingItem={aiUpdate && <AiUpdateSection update={aiUpdate} onFollow={close} />}
        onClose={close}
        onReturnFocus={() => restoreFocus(returnFocus.current)}
      />
    </Suspense>
  )
}
