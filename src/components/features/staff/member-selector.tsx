import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel, FieldError } from '#/components/ui/field'
import type { MemberOption } from '#/components/features/team/shared/types'

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
  available: ReadonlyArray<MemberOption>
}>

export function MemberSelector({ field, available }: Props) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  const selected = new Set(field.state.value)

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel>
        Organization members{' '}
        {selected.size > 0 && (
          <span className="font-normal text-muted-foreground">
            ({selected.size} selected)
          </span>
        )}
      </FieldLabel>
      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          All members already participate here.
        </p>
      ) : (
        <>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border-b px-3 pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Checkbox
              checked={
                selected.size === available.length
                  ? true
                  : selected.size > 0
                    ? 'indeterminate'
                    : false
              }
              onCheckedChange={(checked) => {
                field.handleChange(
                  checked ? available.map((member) => member.userId) : [],
                )
              }}
            />
            Select all
          </label>
          <div className="max-h-60 space-y-2 overflow-y-auto p-3">
            {available.map((m) => (
              <label
                key={m.userId}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  checked={selected.has(m.userId)}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...field.state.value, m.userId]
                      : field.state.value.filter((id: string) => id !== m.userId)
                    field.handleChange(next)
                  }}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium leading-none">{m.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.email}</p>
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
