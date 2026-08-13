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
