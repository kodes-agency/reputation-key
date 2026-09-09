import { Languages } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { ReviewLanguageReadiness as ReviewLanguageReadinessState } from './reply-language-options'

type Props = Readonly<{
  propertyId: string
  hasPropertyDefault: boolean
  reviewLanguageReadiness: ReviewLanguageReadinessState
  isAutoDetecting: boolean
}>

export function ReplyLanguageReadiness({
  propertyId,
  hasPropertyDefault,
  reviewLanguageReadiness,
  isAutoDetecting,
}: Props) {
  const { can } = usePermissions()
  if (hasPropertyDefault) return null

  const canManageAi = can('ai.manage')
  const title = 'Property reply language not set'
  const description =
    reviewLanguageReadiness === 'detectable'
      ? isAutoDetecting
        ? 'We’ll detect this review’s language for this draft. Set a property default so future replies start in your local language.'
        : 'Set a property default so future replies start in your local language.'
      : reviewLanguageReadiness === 'insufficient_language_evidence'
        ? 'This review is too short to detect its language. Set a property default to load a local template.'
        : 'This review has no text. Set a property default to load a local template.'

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
