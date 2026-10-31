import type { ProductUpdatesClientGetter } from '#/shared/whats-new/types'
import { useQuery } from '@tanstack/react-query'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { productUpdatesQuery } from './queries'

type Props = Readonly<{
  getClient: ProductUpdatesClientGetter
  /**
   * `trigger` marks the account button, `menu` the "What's new" item inside the
   * menu. Both read one query, so the first fetch serves the other.
   */
  placement?: 'trigger' | 'menu'
  /** The id the account button names in `aria-describedby` (`trigger` only). */
  hintId?: string
}>

/**
 * The unseen-updates marker. It is a lazy chunk: the top bar mounts the trigger
 * on every authenticated page, and the first-paint closure has almost no room.
 */
export default function ProductUpdatesDot({
  getClient,
  placement = 'menu',
  hintId,
}: Props) {
  const query = useQuery(productUpdatesQuery(usePropertyId(), getClient))
  if (!query.data?.unseenIds.length) return null
  if (placement === 'trigger')
    return (
      <>
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background"
        />
        {/* The button's name stays "Account menu"; this is its description. */}
        <span id={hintId} className="sr-only">
          New updates
        </span>
      </>
    )
  return (
    <>
      <span aria-hidden="true" className="ml-auto size-2 rounded-full bg-primary" />
      <span className="sr-only"> — Unseen updates</span>
    </>
  )
}
