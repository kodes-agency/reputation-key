import { AlertCircle, CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react'
import type { ImportProgressItemDto } from '#/contexts/integration/application/public-api'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { importItemMessage } from './google-import-progress-model'

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
  if (item.status === 'imported' || item.status === 'relinked') {
    return <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
  }
  if (item.status === 'failed') {
    return <XCircle className="size-4 text-destructive" aria-hidden="true" />
  }
  return <AlertCircle className="size-4 text-amber-600" aria-hidden="true" />
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
      disabled={retryingItemId !== null}
      onClick={() => onRetry(item)}
    >
      {isRetrying ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <RotateCcw aria-hidden="true" />
      )}
      {isRetrying ? 'Retrying…' : mobile ? 'Retry this property' : 'Retry'}
    </Button>
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
                  <RetryButton
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
            <RetryButton
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
