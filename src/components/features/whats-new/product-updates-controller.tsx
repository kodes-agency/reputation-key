import type {
  ProductUpdatesClientGetter,
  ProductUpdatesView,
} from '#/shared/whats-new/types'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { productUpdatesQuery } from './queries'
import { productUpdatesSession } from './auto-open'
import { selectModalUpdates } from './selection'
import { useMarkProductUpdatesSeen } from './use-product-update-actions'

const loadModal = () => import('./product-updates-modal')
const Modal = lazy(() => loadModal().then((m) => ({ default: m.ProductUpdatesModal })))
type Selection = ReturnType<typeof selectModalUpdates> & { propertyId: string | null }
type Props = Readonly<{ person: string; getClient: ProductUpdatesClientGetter }>

function useAutomaticOpening(
  { person, getClient }: Props,
  data: ProductUpdatesView | undefined,
  propertyId: string | null,
  open: (value: Selection) => void,
) {
  const current = useRef({ data, propertyId, mounted: true })
  useEffect(() => {
    current.current = { data, propertyId, mounted: true }
    return () => {
      current.current.mounted = false
    }
  })
  useEffect(() => {
    if (!data) return
    const conditions = () => ({
      shouldAutoOpen:
        current.current.mounted &&
        current.current.propertyId === propertyId &&
        current.current.data?.shouldAutoOpen === true,
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      dialogOpen: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
    })
    void productUpdatesSession
      .attempt(
        person,
        conditions,
        async () => {
          // Download before claiming, so waiting for code cannot open over another dialog.
          await loadModal()
          return (await getClient()).claim({
            data: { propertyId: propertyId ?? undefined },
          })
        },
        () => open({ ...selectModalUpdates(data), propertyId }),
      )
      .catch(() => undefined)
  }, [person, data, propertyId, getClient, open])
}

function restoreFocus(target: HTMLElement | null) {
  if (target?.isConnected && target !== document.body) target.focus()
  else document.querySelector<HTMLElement>('[aria-label="Account menu"]')?.focus()
}

export default function ProductUpdatesController(props: Props) {
  const propertyId = usePropertyId()
  const query = useQuery(productUpdatesQuery(propertyId, props.getClient))
  const [selection, setSelection] = useState<Selection | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const markSeen = useMarkProductUpdatesSeen(
    selection?.propertyId ?? propertyId,
    props.getClient,
  )
  const open = (value: Selection) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(value)
  }
  useAutomaticOpening(props, query.data, propertyId, open)
  if (!selection) return null
  const close = () => {
    void markSeen(
      [...selection.highlights, ...selection.fixes].map(({ id }) => id),
    ).catch(() => undefined)
    setSelection(null)
  }
  return (
    <Suspense fallback={null}>
      <Modal
        {...selection}
        onClose={close}
        onReturnFocus={() => restoreFocus(returnFocus.current)}
      />
    </Suspense>
  )
}
