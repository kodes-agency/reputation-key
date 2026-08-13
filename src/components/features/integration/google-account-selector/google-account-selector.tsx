import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

type Props = Readonly<{
  connections: readonly GoogleConnectionDto[]
  value: string | undefined
  onValueChange: (value: string) => void
}>

function connectionLabel(connection: GoogleConnectionDto): string {
  const visibilityLabel = connection.visibility === 'private' ? 'you' : 'organization'
  return `Google account (${visibilityLabel})`
}
export function GoogleAccountSelector({ connections, value, onValueChange }: Props) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full max-w-[300px]" id="google-account-select">
        <SelectValue placeholder="Select Google account" />
      </SelectTrigger>
      <SelectContent>
        {connections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connectionLabel(connection)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
