import type { ImportParentStatus } from '#/contexts/integration/application/public-api'
import type { StatusMap } from '#/components/ui/status-badge'

// Apart from the progress model on purpose: that module is shared with the
// import's queries, which sit in the first-paint closure, and a pill's labels
// are only read by the progress view.

/** How the import's overall state reads as a pill beside its heading. */
export const PARENT_STATUS: StatusMap<ImportParentStatus> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'In progress', tone: 'neutral' },
  completed: { label: 'Complete', tone: 'positive' },
  completed_with_issues: { label: 'Complete with issues', tone: 'warn' },
  failed: { label: 'Failed', tone: 'negative' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}
