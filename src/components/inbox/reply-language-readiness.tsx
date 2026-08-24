import { Languages } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'

type Props = Readonly<{
  propertyId: string
  hasPropertyDefault: boolean
  hasReviewText: boolean
  isAutoDetecting: boolean
}>

export function ReplyLanguageReadiness({
  propertyId,
  hasPropertyDefault,
  hasReviewText,
  isAutoDetecting,
}: Props) {
  const { can } = usePermissions()
  if (hasPropertyDefault && hasReviewText) return null

  const canManageAi = can('ai.manage')
  const title = hasReviewText
    ? 'Property reply language not set'
    : 'AI drafting needs written review text'
  const description = hasReviewText
    ? isAutoDetecting
      ? 'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.'
      : 'Set a property default so future replies start in your local language.'
    : hasPropertyDefault
      ? 'You can still write a reply manually, but AI cannot draft from a rating alone.'
      : 'You can still reply manually. Set a default language for manual replies; AI remains unavailable because this review has no text.'

  return (
    <Alert role="status" aria-live="polite">
      <Languages />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        {!hasPropertyDefault &&
          (canManageAi ? (
            <Button asChild size="xs" variant="link">
              <Link to="/settings/ai" search={{ propertyId }}>
                Set property language
              </Link>
            </Button>
          ) : (
            <p>Ask a manager to set this property’s reply language.</p>
          ))}
      </AlertDescription>
    </Alert>
  )
}
