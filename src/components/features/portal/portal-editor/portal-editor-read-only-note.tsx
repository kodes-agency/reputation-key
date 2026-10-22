// The one quiet line above a read-only Page tab: that the person can look but not
// change, and why (portal-editor-read-only). The line of the Portals list's
// changes-off note, for the editor.
import { Info } from 'lucide-react'

export function PortalEditorReadOnlyNote({ line }: Readonly<{ line: string | null }>) {
  if (line === null) return null
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Info className="size-4 shrink-0" aria-hidden="true" />
      {line}
    </p>
  )
}
