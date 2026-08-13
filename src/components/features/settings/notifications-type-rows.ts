import type { NotificationCategory } from '#/contexts/notification/application/public-api'

export const CATEGORY_ROWS: ReadonlyArray<{
  category: NotificationCategory
  label: string
  description: string
}> = [
  {
    category: 'mandatory',
    label: 'Account and safety',
    description: 'Required account, security, and service notices.',
  },
  {
    category: 'urgent_operational',
    label: 'Urgent operations',
    description: 'Escalations and failures that may require immediate action.',
  },
  {
    category: 'workflow_collaboration',
    label: 'Workflow and collaboration',
    description: 'Reviews, assignments, notes, and reply updates.',
  },
  {
    category: 'digest_summary',
    label: 'Daily summaries',
    description: 'A property-specific summary delivered at 08:00 property-local time.',
  },
  {
    category: 'recognition',
    label: 'Recognition',
    description: 'Recognition updates for activated properties.',
  },
]
