// Footer: fixed text, shown so a manager knows what guests read at the bottom of
// the page. It has nothing to edit.

import { Lock } from 'lucide-react'
import { PortalEditorSectionFrame } from '../portal-editor-section-frame'

export function FooterSection() {
  return (
    <PortalEditorSectionFrame section="footer">
      <div className="flex items-start gap-3 rounded-md border px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Privacy notice</p>
          <p className="text-muted-foreground">
            Every page ends with a link to the privacy notice and a short note that the
            page counts visits. This text is fixed and cannot be changed or hidden.
          </p>
        </div>
      </div>
    </PortalEditorSectionFrame>
  )
}
