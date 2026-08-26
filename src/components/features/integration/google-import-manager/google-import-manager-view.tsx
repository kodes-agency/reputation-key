import { useEffect } from 'react'
import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import { GoogleAccountSelector } from '#/components/features/integration/google-account-selector'
import { ConnectGoogleButton } from '#/components/features/integration/connect-google-button'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import { GoogleImportDiscoveryPanel } from './google-import-discovery-panel'
import { discoveryErrorMessage } from './google-import-error-messages'
import type { GoogleImportGetAuthUrl } from './google-import-manager-contract'
import { StaleGoogleImportViewError } from './google-import-content-lifecycle'
import { GoogleImportReviewForm } from './google-import-review-form'
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

function visibleError(error: unknown): string | null {
  if (!error || error instanceof StaleGoogleImportViewError) return null
  return discoveryErrorMessage(error)
}

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
  const hasActiveConnection = connections.some(
    (connection) => connection.status === 'active',
  )
  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {discovery.step === 'review' ? (
              <BreadcrumbLink asChild>
                <button
                  type="button"
                  disabled={startPending}
                  onClick={() => discovery.setStep('discover')}
                >
                  Select locations
                </button>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>Select locations</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {discovery.step === 'review' ? (
              <BreadcrumbPage>Review details</BreadcrumbPage>
            ) : (
              <span>Review details</span>
            )}
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <span>Import</span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="gap-4">
        <CardHeader>
          <CardTitle>Google Business Profile connection</CardTitle>
          <CardDescription>
            Discovery content is temporary and is removed when you leave or hide this
            page.
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

      {connections.length === 0 ? (
        <Alert>
          <AlertTitle>Connect Google to import properties</AlertTitle>
          <AlertDescription>
            Use the connection button above. RepKey only shows provider content while this
            page is active.
          </AlertDescription>
        </Alert>
      ) : !hasActiveConnection ? (
        <Alert>
          <AlertTitle>Reconnect Google to continue</AlertTitle>
          <AlertDescription>
            None of the saved Google connections can be used for discovery. Connect Google
            again to restore access.
          </AlertDescription>
        </Alert>
      ) : !discovery.contentActive ? (
        <Alert>
          <AlertTitle>Google location details were cleared</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              RepKey removes temporary provider content when this page is hidden, expires,
              or loses authorization.
            </p>
            <Button type="button" variant="outline" onClick={discovery.resumeDiscovery}>
              Rediscover locations
            </Button>
          </AlertDescription>
        </Alert>
      ) : discovery.step === 'review' && discovery.reviewDraft ? (
        <GoogleImportReviewForm
          form={reviewForm}
          onBack={() => discovery.setStep('discover')}
          isSubmitting={startPending}
          submitError={startError}
        />
      ) : (
        <GoogleImportDiscoveryPanel
          accounts={discovery.accounts}
          candidates={discovery.visibleCandidates}
          selectedAccountRef={discovery.accountRef}
          selectedIds={discovery.selectedIds}
          search={discovery.search}
          isLoadingAccounts={discovery.accountsQuery.isPending}
          isLoadingMoreAccounts={discovery.accountsQuery.isFetchingNextPage}
          hasMoreAccounts={discovery.accountsQuery.hasNextPage}
          isLoadingCandidates={discovery.candidatesQuery.isPending}
          isLoadingMoreCandidates={discovery.candidatesQuery.isFetchingNextPage}
          hasMoreCandidates={discovery.candidatesQuery.hasNextPage}
          accountsError={visibleError(discovery.accountsQuery.error)}
          candidatesError={visibleError(discovery.candidatesQuery.error)}
          selectAllError={discovery.selectAllError}
          isSelectingAll={discovery.selectAllPending}
          onSearchChange={discovery.setSearch}
          onSelectAccount={discovery.selectAccount}
          onToggleCandidate={discovery.toggleCandidate}
          onToggleLoaded={discovery.toggleLoaded}
          onSelectAllEligible={() => void discovery.selectAllEligible()}
          onLoadMoreAccounts={() => void discovery.accountsQuery.fetchNextPage()}
          onLoadMoreCandidates={() => void discovery.candidatesQuery.fetchNextPage()}
          onReview={discovery.review}
        />
      )}

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
