import { Field, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { TeamOption } from '#/components/features/team/shared/types'

type Props = Readonly<{
  field: {
    state: {
      value: string | null
    }
    handleChange: (value: string | null) => void
  }
  teams: ReadonlyArray<TeamOption>
}>

export function TeamSelector({ field, teams }: Props) {
  return (
    <Field>
      <FieldLabel>Assign to team (optional)</FieldLabel>
      <Select
        value={field.state.value ?? '__none__'}
        onValueChange={(value) => field.handleChange(value === '__none__' ? null : value)}
      >
        <SelectTrigger>
          <SelectValue placeholder="No team" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__none__">
              <span className="italic text-muted-foreground">
                No team (direct to property)
              </span>
            </SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
