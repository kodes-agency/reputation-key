import { Checkbox } from '#/components/ui/checkbox'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

type ParticipationOption = Readonly<{
  id: string
  displayName: string
}>

type Props = Readonly<{
  available: ReadonlyArray<ParticipationOption>
  selectedIds: Set<string>
  onToggleMember: (staffParticipationId: string) => void
  onToggleAll: () => void
  onAdd: () => void
  onCancel: () => void
  error: unknown
  isAdding: boolean
}>

export function AddMembersDialogContent({
  available,
  selectedIds,
  onToggleMember,
  onToggleAll,
  onAdd,
  onCancel,
  error,
  isAdding,
}: Props) {
  return (
    <>
      <div className="space-y-3">
        {available.length > 1 && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 border-b pb-2">
            <Checkbox
              checked={selectedIds.size === available.length}
              onCheckedChange={onToggleAll}
              aria-label="Select all available staff"
            />
            <span className="text-sm text-muted-foreground">
              {selectedIds.size === available.length ? 'Deselect all' : 'Select all'}
            </span>
          </label>
        )}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {available.map((participation) => (
            <label
              key={participation.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <Checkbox
                checked={selectedIds.has(participation.id)}
                onCheckedChange={() => onToggleMember(participation.id)}
                aria-label={`Select ${participation.displayName}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {participation.displayName}
              </span>
            </label>
          ))}
        </div>
        <FormErrorBanner error={error} />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} disabled={isAdding}>
          Cancel
        </Button>
        <Button onClick={onAdd} disabled={selectedIds.size === 0 || isAdding}>
          {isAdding
            ? 'Adding…'
            : `Add ${selectedIds.size || ''} member${selectedIds.size !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </>
  )
}
