import { Checkbox } from '#/components/ui/checkbox'
import { Button } from '#/components/ui/button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { MemberLike } from '#/lib/lookups'

type Props = Readonly<{
  available: ReadonlyArray<MemberLike>
  selectedIds: Set<string>
  onToggleMember: (userId: string) => void
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
          <div className="flex items-center gap-2 border-b pb-2">
            <Checkbox
              checked={selectedIds.size === available.length}
              onCheckedChange={onToggleAll}
              aria-label="Select all"
            />
            <span className="text-sm text-muted-foreground">
              {selectedIds.size === available.length ? 'Deselect all' : 'Select all'}
            </span>
          </div>
        )}
        <div className="max-h-[300px] space-y-1 overflow-y-auto">
          {available.map((m) => (
            <label
              key={m.userId}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <Checkbox
                checked={selectedIds.has(m.userId)}
                onCheckedChange={() => onToggleMember(m.userId)}
                aria-label={`Select ${m.name}`}
              />
              <div className="flex-1">
                <div className="text-sm font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground">{m.email}</div>
              </div>
            </label>
          ))}
        </div>
        <FormErrorBanner error={error} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isAdding}>
          Cancel
        </Button>
        <Button onClick={onAdd} disabled={selectedIds.size === 0 || isAdding}>
          {isAdding
            ? 'Adding...'
            : `Add ${selectedIds.size || ''} member${selectedIds.size !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </>
  )
}
