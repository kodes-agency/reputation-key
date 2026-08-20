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
  disabled?: boolean
}>

const CONNECTION_STATUS_LABELS: Readonly<Record<GoogleConnectionDto['status'], string>> =
  {
    pending: 'Pending',
    active: 'Active',
    degraded: 'Temporarily unavailable',
    reauth_required: 'Reconnect required',
    disconnecting: 'Disconnecting',
    disconnected: 'Disconnected',
    failed: 'Connection failed',
  }

function connectionLabel(connection: GoogleConnectionDto): string {
  const visibilityLabel = connection.visibility === 'private' ? 'you' : 'organization'
  const statusLabel =
    connection.status === 'active'
      ? ''
      : ` — ${CONNECTION_STATUS_LABELS[connection.status]}`
  return `Google account (${visibilityLabel})${statusLabel}`
}
export function GoogleAccountSelector({
  connections,
  value,
  onValueChange,
  disabled = false,
}: Props) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-full max-w-[300px]" id="google-account-select">
        <SelectValue placeholder="Select Google account" />
      </SelectTrigger>
      <SelectContent>
        {connections.map((connection) => (
          <SelectItem
            key={connection.id}
            value={connection.id}
            disabled={connection.status !== 'active'}
          >
            {connectionLabel(connection)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
