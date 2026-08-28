import { Button } from '#/components/ui/button'
import type { GuestPortalCopy } from './guest-language-pack'

export function GuestGatewayLoading() {
  return (
    <section aria-busy="true" className="rounded-lg border p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-20 animate-pulse rounded bg-muted/60" />
    </section>
  )
}

export function GuestGatewayUnavailable({ copy }: Readonly<{ copy: GuestPortalCopy }>) {
  return (
    <section role="status" className="rounded-lg border p-5 text-center">
      <h2 className="font-semibold">{copy.gatewayUnavailableTitle}</h2>
      <p className="mt-2 text-sm">{copy.gatewayUnavailableBody}</p>
    </section>
  )
}

export function GuestWithdrawnReceipt({ copy }: Readonly<{ copy: GuestPortalCopy }>) {
  return (
    <section role="status" className="rounded-lg border p-5 text-center">
      <h2 className="font-semibold">{copy.responseWithdrawnTitle}</h2>
      <p className="mt-2 text-sm">{copy.responseWithdrawnBody}</p>
    </section>
  )
}

export function GoogleReviewAction({
  available,
  pending,
  onSelect,
  copy,
}: Readonly<{
  available: boolean
  pending: boolean
  onSelect: () => void
  copy: GuestPortalCopy
}>) {
  if (!available) {
    return (
      <div role="status" className="rounded-lg border p-5 text-center">
        <h2 className="text-lg font-semibold">{copy.googleUnavailableTitle}</h2>
        <p className="mt-1 text-sm">{copy.googleUnavailableBody}</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border p-5 text-center">
      <h2 className="text-lg font-semibold">{copy.googleTitle}</h2>
      <p className="mt-1 text-sm">{copy.googleBody}</p>
      <Button
        type="button"
        size="lg"
        disabled={pending}
        onClick={onSelect}
        className="mt-4 w-full bg-[color:var(--portal-primary)] text-white hover:bg-[color:var(--portal-primary)] hover:opacity-90 focus-visible:ring-[color:var(--portal-primary)]"
      >
        {copy.continueToGoogle}
      </Button>
    </div>
  )
}
