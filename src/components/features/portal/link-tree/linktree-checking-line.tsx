// The status line shown in place of a tile's approval while the server checks its
// address, so the previous address's state never shows for the new one. A status,
// not a button's pending state, so it lives apart from the approval's buttons.
import { LoaderCircle } from 'lucide-react'

export function LinktreeCheckingLine() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle
        aria-hidden="true"
        className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
      />
      Checking address…
    </p>
  )
}
