import { Button } from '#/components/ui/button'
import type { GuestPortalCopy } from './guest-language-pack'

export function GuestResponseSessionReset({
  pending,
  onStart,
  copy,
}: Readonly<{ pending: boolean; onStart: () => void; copy: GuestPortalCopy }>) {
  return (
    <div className="rounded-lg border p-4 text-sm">
      <p>{copy.sharedDevicePrompt}</p>
      <Button
        type="button"
        variant="link"
        disabled={pending}
        onClick={onStart}
        className="-ml-4 mt-1 text-current underline"
      >
        {copy.startNewResponse}
      </Button>
      <p className="mt-2">{copy.earlierResponseSaved}</p>
    </div>
  )
}
