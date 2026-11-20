import { Alert, AlertDescription } from '#/components/ui/alert'
import type { ReplyDraftCheckDto } from '#/contexts/review/application/dto/reply-library.dto'

export function ReplyDraftCheckAlerts({
  checks,
}: Readonly<{ checks: ReplyDraftCheckDto | null }>) {
  if (!checks) return null
  return (
    <div className="flex flex-col gap-2">
      {checks.blocks.map((finding) => (
        <Alert key={finding.code} variant="destructive">
          <AlertDescription>{finding.message}</AlertDescription>
        </Alert>
      ))}
      {checks.warnings.map((finding) => (
        <Alert key={finding.code} variant="warning">
          <AlertDescription>{finding.message}</AlertDescription>
        </Alert>
      ))}
      {checks.similar ? (
        <Alert variant="warning">
          <AlertDescription>
            Similar to a recent reply on your Google profile (
            {Math.round(checks.maxSimilarity * 100)}%).
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
