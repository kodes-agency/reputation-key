import { Clock } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'

export function PropertyAiProvisionalNotice({
  coverage: { awaitingAnalysisCount },
  comparisonsSuppressed = false,
  className,
}: Readonly<{
  coverage: Readonly<{ awaitingAnalysisCount: number }>
  comparisonsSuppressed?: boolean
  className?: string
}>) {
  return (
    <Alert className={className}>
      <Clock aria-hidden="true" />
      <AlertTitle>Provisional figures</AlertTitle>
      <AlertDescription>
        Figures are still filling in. {awaitingAnalysisCount}{' '}
        {awaitingAnalysisCount === 1 ? 'review' : 'reviews'} awaiting analysis.
        {comparisonsSuppressed
          ? ' Period-over-period comparisons are hidden until analysis is complete.'
          : null}
      </AlertDescription>
    </Alert>
  )
}
