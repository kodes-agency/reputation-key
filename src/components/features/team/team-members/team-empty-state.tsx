import { Users } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'

type Props = Readonly<{
  canManage: boolean
  hasAvailable: boolean
  onAdd: () => void
}>

export function TeamEmptyState({ canManage, hasAvailable, onAdd }: Props) {
  return (
    <EmptyState icon={Users} title="This team has no active members">
      <p className="max-w-sm text-sm text-muted-foreground">
        {canManage
          ? 'Add active staff to start building this team.'
          : 'A manager can add active staff to this team.'}
      </p>
      {canManage && hasAvailable && (
        <Button variant="outline" size="sm" onClick={onAdd}>
          Add first members
        </Button>
      )}
    </EmptyState>
  )
}
