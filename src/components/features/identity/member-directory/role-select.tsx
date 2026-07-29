import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { Role } from '#/shared/domain/roles'

type Props = Readonly<{
  role: Role | null
  onRoleChange: (role: 'AccountAdmin' | 'PropertyManager' | 'Staff') => void
  isPending: boolean
  /**
   * Accessible name context (the member's name). BQC-6.8: the trigger has no
   * guaranteed text content before the select content mounts (Radix renders
   * the value span lazily), so the combobox needs an explicit aria-label —
   * axe button-name on /settings/members.
   */
  memberName: string
}>

export function RoleSelect({ role, onRoleChange, isPending, memberName }: Props) {
  return (
    <Select value={role ?? undefined} onValueChange={onRoleChange} disabled={isPending}>
      <SelectTrigger className="w-[160px]" aria-label={`Role for ${memberName}`}>
        <SelectValue placeholder="Custom role" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="AccountAdmin">Account Admin</SelectItem>
          <SelectItem value="PropertyManager">Property Manager</SelectItem>
          <SelectItem value="Staff">Staff</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
