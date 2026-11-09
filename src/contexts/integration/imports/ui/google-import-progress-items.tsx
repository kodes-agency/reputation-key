import { Link } from '@tanstack/react-router'
import { ArrowRight, Loader2, RotateCcw } from 'lucide-react'
import type { ImportProgressItemDto } from '#/contexts/integration/application/public-api'
import { Button } from '#/components/ui/button'
import { TONE_ICON, TONE_INK, type Tone } from '#/components/ui/tone'
import { cn } from '#/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  importItemMessage,
  importItemNeedsReimport,
} from './google-import-progress-model'

type Props = Readonly<{
  items: readonly ImportProgressItemDto[]
  retryingItemId: string | null
  onRetry: (item: ImportProgressItemDto) => void
}>

function statusIcon(item: ImportProgressItemDto) {
  if (item.status === 'pending' || item.status === 'processing') {
    return (
      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
    )
  }
  // Done, failed, and "settled some other way" (already there, cancelled): the
  // tone table's three icons, so a row reads as it does everywhere else.
  const tone: Exclude<Tone, 'neutral' | 'info'> =
    item.status === 'imported' || item.status === 'relinked'
      ? 'positive'
      : item.status === 'failed'
        ? 'negative'
        : 'warn'
  const Icon = TONE_ICON[tone]
  return <Icon className={cn('size-4', TONE_INK[tone])} aria-hidden="true" />
}

function RetryButton({
  item,
  retryingItemId,
  mobile = false,
  onRetry,
}: Readonly<{
  item: ImportProgressItemDto
  retryingItemId: string | null
  mobile?: boolean
  onRetry: (item: ImportProgressItemDto) => void
}>) {
  if (!item.retryable) return null
  const isRetrying = retryingItemId === item.itemId
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={mobile ? 'w-full' : undefined}
      pending={isRetrying}
      pendingLabel="Trying again…"
      disabled={retryingItemId !== null}
      onClick={() => onRetry(item)}
    >
      <RotateCcw aria-hidden="true" />
      {mobile ? 'Try this property again' : 'Try again'}
    </Button>
  )
}

/**
 * Imported and relinked items link straight to the Property they produced and
 * an already-bound location to the Property that holds it; a rejected profile
 * sends the manager back to import the location again.
 */
function NextStep({
  item,
  retryingItemId,
  mobile = false,
  onRetry,
}: Readonly<{
  item: ImportProgressItemDto
  retryingItemId: string | null
  mobile?: boolean
  onRetry: (item: ImportProgressItemDto) => void
}>) {
  if (importItemNeedsReimport(item)) {
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className={mobile ? 'w-full' : undefined}
      >
        <Link
          to="/properties/import-google"
          aria-label={`Import ${item.propertyName} again`}
        >
          Import again
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    )
  }
  if (item.propertyId !== null) {
    // An already-bound location links to the Property that holds it, which may
    // carry a different name than the one confirmed for this import.
    const existing = item.status === 'already_exists'
    return (
      <Button
        asChild
        size="sm"
        variant="outline"
        className={mobile ? 'w-full' : undefined}
      >
        <Link
          to="/properties/$propertyId"
          params={{ propertyId: item.propertyId }}
          aria-label={
            existing
              ? `View the existing property for ${item.propertyName}`
              : `View property ${item.propertyName}`
          }
        >
          {existing ? 'View existing property' : 'View property'}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    )
  }
  return (
    <RetryButton
      item={item}
      retryingItemId={retryingItemId}
      mobile={mobile}
      onRetry={onRetry}
    />
  )
}

export function GoogleImportProgressItems({ items, retryingItemId, onRetry }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Next step</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.itemId}>
                <TableCell className="max-w-80 whitespace-normal font-medium">
                  {item.propertyName}
                </TableCell>
                <TableCell className="capitalize">{item.action}</TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  <span className="flex items-start gap-2">
                    {statusIcon(item)}
                    <span>{importItemMessage(item)}</span>
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <NextStep
                    item={item}
                    retryingItemId={retryingItemId}
                    onRetry={onRetry}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y md:hidden">
        {items.map((item) => (
          <article key={item.itemId} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words font-medium">{item.propertyName}</h3>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                  {item.action}
                </p>
              </div>
              {statusIcon(item)}
            </div>
            <p className="text-sm">{importItemMessage(item)}</p>
            <NextStep
              item={item}
              retryingItemId={retryingItemId}
              mobile
              onRetry={onRetry}
            />
          </article>
        ))}
      </div>
    </div>
  )
}
