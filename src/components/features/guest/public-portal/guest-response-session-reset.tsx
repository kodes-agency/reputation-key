import { Button } from '#/components/ui/button'

export function GuestResponseSessionReset({
  pending,
  onStart,
}: Readonly<{ pending: boolean; onStart: () => void }>) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <p>Using a shared device? You can clear this receipt for the next visitor.</p>
      <Button
        type="button"
        variant="link"
        disabled={pending}
        onClick={onStart}
        className="-ml-4 mt-1 text-current underline"
      >
        Start a new response
      </Button>
      <p className="mt-2">The response already submitted will remain saved.</p>
    </div>
  )
}
