import { GoogleConnection } from '#/contexts/integration/domain/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

interface GoogleAccountSelectorProps {
  connections: GoogleConnection[]
  value: string | undefined
  onValueChange: (value: string) => void
}

export function GoogleAccountSelector({
  connections,
  value,
  onValueChange,
}: GoogleAccountSelectorProps) {
  const getDisplayName = (connection: GoogleConnection): string => {
    const visibilityLabel = connection.visibility === 'private' ? '(you)' : '(shared)'
    return `${connection.googleEmail} ${visibilityLabel}`
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-[300px]">
        <SelectValue placeholder="Select Google account" />
      </SelectTrigger>
      <SelectContent>
        {connections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {getDisplayName(connection)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
