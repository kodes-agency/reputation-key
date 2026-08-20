import { Loader2 } from 'lucide-react'
import { Skeleton } from '#/components/ui/skeleton'

export function GoogleImportLoadingRows({ label }: Readonly<{ label: string }>) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-4/5" />
    </div>
  )
}

export function GoogleImportRecoveryStatus() {
  return (
    <div
      className="flex min-h-40 items-center justify-center gap-3 rounded-xl border bg-card p-6 text-sm"
      role="status"
    >
      <Loader2
        className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
      Recovering the import request…
    </div>
  )
}
