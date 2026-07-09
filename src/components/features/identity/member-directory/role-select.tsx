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
}>

export function RoleSelect({ role, onRoleChange, isPending }: Props) {
  return (
    <Select value={role ?? undefined} onValueChange={onRoleChange} disabled={isPending}>
      <SelectTrigger className="w-[160px]">
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
