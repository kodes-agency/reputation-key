// The one line under the workspace header that says why nothing in this portal
// can be changed, and the way out where there is one. Every tab keeps its fields
// read-only; this is where the reason is said, once, instead of each tab
// greying out with no word on why.
//
// - role: the person's role can read portals but not change them;
// - capability: portal changes are switched off for the organization;
// - archived: a place Portal is retained as it was; Restore brings it back disabled;
// - staff_removed: a personal Portal stays archived after Staff Remove.

import type { ReactNode } from 'react'
import { Archive, Eye, Lock } from 'lucide-react'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { cn } from '#/lib/utils'
import type { PortalReadOnlyReason } from '../portal-detail/portal-edit-access'

const NOTICE: Readonly<
  Record<
    PortalReadOnlyReason | 'staff_removed',
    Readonly<{ icon: typeof Lock; text: string }>
  >
> = {
  role: {
    icon: Eye,
    text: 'You can look at this portal, but your role doesn’t allow changing it.',
  },
  capability: {
    icon: Lock,
    text: 'You can look at this portal, but changing portals isn’t available for your organization right now.',
  },
  staff_removed: {
    icon: Archive,
    text: 'This person’s portal has been removed. Their past results stay in your totals.',
  },
  archived: {
    icon: Archive,
    text: 'This portal is archived, so its page can’t be changed until it is restored.',
  },
}

export function PortalReadOnlyNotice({
  reason,
  action,
}: Readonly<{
  reason: PortalReadOnlyReason | 'staff_removed'
  /** The way out, beside the line (Restore for an archived portal). */
  action?: ReactNode
}>) {
  const { icon: Icon, text } = NOTICE[reason]
  return (
    <div
      role="status"
      data-slot="portal-read-only-notice"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/40 py-2 text-sm text-muted-foreground',
        PAGE_GUTTER_X,
      )}
    >
      <p className="flex min-w-0 flex-1 basis-64 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </p>
      {action}
    </div>
  )
}
