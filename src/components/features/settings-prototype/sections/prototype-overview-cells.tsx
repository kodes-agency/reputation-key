// PROTOTYPE — the cells of the all-properties table and matrix. One property, one row,
// each column a status the AccountAdmin can scan: setup, Google, language, AI, manager, target.
import type { ReactNode } from 'react'
import { Badge } from '#/components/ui/badge'
import { StatusBadge } from '#/components/ui/status-badge'
import { setupProgressOf } from '../settings-prototype-fixtures'
import type {
  PropertyFixture,
  PrototypeRole,
  SettingsPrototypeData,
} from '../settings-prototype-types'
import { AI_STATUS } from './prototype-ai-section'
import { GOOGLE_STATUS } from './prototype-business-sections'

export const OVERVIEW_COLUMNS = [
  'Setup',
  'Google',
  'Language',
  'AI',
  'Manager',
  'Target',
] as const

/** Every cell of a property's row, in column order. */
export function overviewCells(
  p: PropertyFixture,
  data: SettingsPrototypeData,
  role: PrototypeRole,
): readonly ReactNode[] {
  const progress = setupProgressOf(p, role)
  const manager = data.members.find((m) => p.managerIds[0] === m.id)
  return [
    <Badge key="setup" variant={progress.nextStep === null ? 'positive' : 'warn'}>
      {progress.done}/{progress.total}
    </Badge>,
    <StatusBadge key="google" status={p.google.state} map={GOOGLE_STATUS} />,
    p.language ?? (
      <Badge key="language" variant="warn">
        Not set
      </Badge>
    ),
    <StatusBadge key="ai" status={p.ai} map={AI_STATUS} />,
    manager ? (
      <span key="manager">
        {manager.name}
        {p.managerIds.length > 1 ? ` +${p.managerIds.length - 1}` : ''}
      </span>
    ) : (
      <Badge key="manager" variant="warn">
        None
      </Badge>
    ),
    p.targets.mode === 'default' ? (
      <span key="target" className="text-muted-foreground">
        Follows default
      </span>
    ) : (
      <span key="target" className="font-medium">
        Custom, {p.targets.privateFeedbackHours} h
      </span>
    ),
  ]
}
