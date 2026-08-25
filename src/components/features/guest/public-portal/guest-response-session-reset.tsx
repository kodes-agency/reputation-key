export function GuestResponseSessionReset({
  pending,
  onStart,
}: Readonly<{ pending: boolean; onStart: () => void }>) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <p>Using a shared device? You can clear this receipt for the next visitor.</p>
      <button
        type="button"
        disabled={pending}
        onClick={onStart}
        className="mt-2 underline disabled:opacity-50"
      >
        Start a new response
      </button>
      <p className="mt-2">The response already submitted will remain saved.</p>
    </div>
  )
}
