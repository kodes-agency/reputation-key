// The two assignable roles as radio cards, each saying what the role can do.
// Shared by the invite form and the Change role dialog so both read the same.

import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { Label } from '#/components/ui/label'
import type { BetaInteractiveRole } from '#/shared/domain/beta-interactive-role'
import {
  roleDescription,
  roleLabel,
} from '#/components/features/identity/shared/role-utils'

type Props = Readonly<{
  /** null while no role is chosen yet. */
  value: BetaInteractiveRole | null
  onValueChange: (role: BetaInteractiveRole) => void
  allowedRoles: ReadonlyArray<BetaInteractiveRole>
  /** Prefixes each radio's id so two groups on one page stay distinct. */
  idPrefix: string
  'aria-labelledby'?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  disabled?: boolean
}>

export function RoleChoice({
  value,
  onValueChange,
  allowedRoles,
  idPrefix,
  'aria-labelledby': labelledBy,
  'aria-label': label,
  'aria-invalid': invalid,
  disabled,
}: Props) {
  return (
    <RadioGroup
      value={value ?? ''}
      onValueChange={(next) => {
        const chosen = allowedRoles.find((role) => role === next)
        if (chosen) onValueChange(chosen)
      }}
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-invalid={invalid}
      disabled={disabled}
    >
      {allowedRoles.map((role) => {
        const id = `${idPrefix}-${role}`
        return (
          <div
            key={role}
            className="flex items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
          >
            <RadioGroupItem value={role} id={id} className="mt-0.5" />
            <Label htmlFor={id} className="flex flex-col items-start gap-1 font-normal">
              <span className="text-sm font-medium">{roleLabel(role, 'full')}</span>
              <span className="text-sm text-muted-foreground">
                {roleDescription(role)}
              </span>
            </Label>
          </div>
        )
      })}
    </RadioGroup>
  )
}
