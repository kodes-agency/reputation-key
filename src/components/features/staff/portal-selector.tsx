import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'

export interface PortalOption {
  id: string
  name: string
}

type Props = Readonly<{
  field: {
    state: {
      value: string[]
      meta: {
        isTouched: boolean
        isValid: boolean
        errors: unknown
      }
    }
    handleChange: (value: string[]) => void
  }
  portals: ReadonlyArray<PortalOption>
}>

export function PortalSelector({ field, portals }: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  const selected = new Set(field.state.value)

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel>
        Portals{' '}
        {selected.size > 0 && (
          <span className="font-normal text-muted-foreground">
            ({selected.size} selected)
          </span>
        )}
      </FieldLabel>
      {portals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No portals available for this property.
        </p>
      ) : (
        <>
          <label className="flex cursor-pointer items-center gap-3 rounded-md border-b px-3 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Checkbox
              checked={
                selected.size === portals.length
                  ? true
                  : selected.size > 0
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={(checked) => {
                field.handleChange(checked ? portals.map((p) => p.id) : [])
              }}
            />
            Select all
          </label>
          <div className="max-h-60 space-y-2 overflow-y-auto p-3">
            {portals.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  checked={selected.has(p.id)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...field.state.value, p.id]
                      : field.state.value.filter((id: string) => id !== p.id)
                    field.handleChange(next)
                  }}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium leading-none">{p.name}</p>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
      {isInvalid && (
        <FieldError
          errors={field.state.meta.errors as Array<{ message?: string } | undefined>}
        />
      )}
    </Field>
  )
}
