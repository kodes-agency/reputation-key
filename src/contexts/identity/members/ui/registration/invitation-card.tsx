import { Card } from '#/components/ui/card'
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  organizationName: string
  role: string
  onAccept: () => void
  disabled: boolean
}>

export function InvitationCard({ organizationName, role, onAccept, disabled }: Props) {
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <div>
          <p className="font-medium">{organizationName}</p>
          <p className="text-sm text-muted-foreground">Role: {role}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onAccept} disabled={disabled}>
            Accept
          </Button>
        </div>
      </div>
    </Card>
  )
}
