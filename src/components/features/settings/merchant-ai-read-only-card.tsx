import { Lock } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'

const AI_ON_OFF: StatusMap<'on' | 'off'> = {
  on: { label: 'On', tone: 'positive' },
  off: { label: 'Off', tone: 'neutral' },
}

/** What is known of the property's AI: its state, or why that is not known. */
export type MerchantAiReadOnlyState = 'on' | 'off' | 'checking' | 'unavailable'

type Props = Readonly<{
  propertyName: string
  state: MerchantAiReadOnlyState
}>

/** The card's state from what the page knows: whether AI is on, once read, or that reading failed. */
export function merchantAiReadOnlyState(
  isOn: boolean | undefined,
  readFailed: boolean,
): MerchantAiReadOnlyState {
  if (isOn !== undefined) return isOn ? 'on' : 'off'
  return readFailed ? 'unavailable' : 'checking'
}

function describe(state: MerchantAiReadOnlyState, propertyName: string): string {
  switch (state) {
    case 'on':
      return `AI is on for ${propertyName}.`
    case 'off':
      return `AI is off for ${propertyName}.`
    case 'checking':
      return 'Checking whether AI is on…'
    case 'unavailable':
      return 'Whether AI is on could not be checked. Try again in a moment.'
  }
}

/**
 * A property's AI state for a role that cannot change it. Consent to AI is an
 * AccountAdmin's decision, so a PropertyManager is shown whether AI is on and
 * who decides, in place of the consent controls and instead of a refusal.
 */
export function MerchantAiReadOnlyCard({ propertyName, state }: Props) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle as="h2">AI features</CardTitle>
        <CardDescription>{describe(state, propertyName)}</CardDescription>
        {state === 'on' || state === 'off' ? (
          <CardAction>
            <StatusBadge status={state} map={AI_ON_OFF} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          An account admin decides whether AI is on.
        </p>
      </CardContent>
    </Card>
  )
}
