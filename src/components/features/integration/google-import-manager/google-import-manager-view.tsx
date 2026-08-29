import { useEffect } from 'react'
import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import { GoogleAccountSelector } from '#/components/features/integration/google-account-selector'
import { ConnectGoogleButton } from '#/components/features/integration/connect-google-button'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import { GoogleImportManagerBody } from './google-import-manager-body'
import { GoogleImportManagerBreadcrumbs } from './google-import-manager-breadcrumbs'
import type { GoogleImportGetAuthUrl } from './google-import-manager-contract'
import type { ImportReviewDraft } from './google-import-review-model'
import type { GoogleImportDiscoveryController } from './use-google-import-discovery-controller'
import { useGoogleImportReviewForm } from './use-google-import-review-form'

type Props = Readonly<{
  connections: readonly GoogleConnectionDto[]
  getAuthUrl: GoogleImportGetAuthUrl
  discovery: GoogleImportDiscoveryController
  startPending: boolean
  startError: string | null
  onSubmit: (draft: ImportReviewDraft) => void | Promise<void>
}>

export function GoogleImportManagerView({
  connections,
  getAuthUrl,
  discovery,
  startPending,
  startError,
  onSubmit,
}: Props) {
  const reviewForm = useGoogleImportReviewForm({
    initialDraft: discovery.reviewDraft,
    onSubmit,
  })
  useEffect(() => {
    if (discovery.reviewDraft) reviewForm.reset(discovery.reviewDraft)
  }, [discovery.reviewDraft, reviewForm])
  return (
    <div className="space-y-6">
      <GoogleImportManagerBreadcrumbs
        step={discovery.step}
        disabled={startPending}
        onBackToDiscover={() => discovery.setStep('discover')}
      />

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Google Business Profile connection</CardTitle>
          <CardDescription>
            Location details are cleared from this screen when it is hidden. You can
            resume within a temporary discovery window that expires within 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <Field className="max-w-xl flex-1">
            <FieldLabel htmlFor="google-account-select">
              Connected Google account
            </FieldLabel>
            <GoogleAccountSelector
              connections={connections}
              value={discovery.connectionId ?? undefined}
              disabled={startPending}
              onValueChange={(value) => void discovery.changeConnection(value)}
            />
          </Field>
          <ConnectGoogleButton getAuthUrl={getAuthUrl} disabled={startPending} />
        </CardContent>
      </Card>

      {startError && !(discovery.step === 'review' && discovery.reviewDraft) ? (
        <Alert variant="destructive">
          <AlertTitle>Import unavailable</AlertTitle>
          <AlertDescription>{startError}</AlertDescription>
        </Alert>
      ) : null}

      <GoogleImportManagerBody
        connections={connections}
        discovery={discovery}
        reviewForm={reviewForm}
        startPending={startPending}
        startError={startError}
      />

      {discovery.contentActive &&
      discovery.reviewCandidates.length > 0 &&
      discovery.step === 'discover' ? (
        <Button type="button" variant="ghost" onClick={() => discovery.setStep('review')}>
          Return to current review
        </Button>
      ) : null}
    </div>
  )
}
