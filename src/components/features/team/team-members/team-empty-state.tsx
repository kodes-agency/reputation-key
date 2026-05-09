import { Button } from '#/components/ui/button'

type Props = Readonly<{
  hasAvailable: boolean
  onAdd: () => void
}>

export function TeamEmptyState({ hasAvailable, onAdd }: Props) {
  return (
    <div className="rounded-lg border py-8 text-center">
      <p className="text-sm text-muted-foreground">No members in this team yet.</p>
      {hasAvailable && (
        <Button variant="link" size="sm" onClick={onAdd}>
          Add first members
        </Button>
      )}
    </div>
  )
}
