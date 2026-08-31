import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { GoogleImportDiscoveryPanel } from './google-import-discovery-panel'
import { discoveryErrorMessage } from './google-import-error-messages'
import { GoogleImportReviewForm } from './google-import-review-form'
import type { GoogleImportDiscoveryController } from './use-google-import-discovery-controller'
import type { GoogleImportReviewFormApi } from './use-google-import-review-form'

type Props = Readonly<{
  connections: readonly GoogleConnectionDto[]
  discovery: GoogleImportDiscoveryController
  reviewForm: GoogleImportReviewFormApi
  startPending: boolean
  startError: string | null
}>

function visibleError(error: unknown): string | null {
  if (!error) return null
  return discoveryErrorMessage(error)
}

function ClearedContentNotice({ onResume }: Readonly<{ onResume: () => void }>) {
  return (
    <Alert>
      <AlertTitle>Google location details were cleared</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          RepKey cleared location details from this screen because the page was hidden or
          the temporary authorization changed. Rediscovery remains available only within
          the bounded window, which expires within 24 hours.
        </p>
        <Button type="button" variant="outline" onClick={onResume}>
          Rediscover locations
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/**
 * The one region of the import screen that swaps wholesale: connection
 * prerequisites, the cleared-content notice, the review form, or the discovery
 * panel. Early returns keep the precedence order explicit — the first
 * unsatisfied prerequisite wins, exactly as the nested ternary chain did.
 */
export function GoogleImportManagerBody({
  connections,
  discovery,
  reviewForm,
  startPending,
  startError,
}: Props) {
  if (connections.length === 0) {
    return (
      <Alert>
        <AlertTitle>Connect Google to import properties</AlertTitle>
        <AlertDescription>
          Use the connection button above. RepKey displays location details only while
          this page is active, with a temporary resume window of up to 24 hours.
        </AlertDescription>
      </Alert>
    )
  }

  if (!connections.some((connection) => connection.status === 'active')) {
    return (
      <Alert>
        <AlertTitle>Reconnect Google to continue</AlertTitle>
        <AlertDescription>
          None of the saved Google connections can be used for discovery. Open Integration
          settings to reauthorize any connection that needs attention.
        </AlertDescription>
      </Alert>
    )
  }

  if (!discovery.contentActive) {
    return <ClearedContentNotice onResume={discovery.resumeDiscovery} />
  }

  if (discovery.step === 'review' && discovery.reviewDraft) {
    return (
      <GoogleImportReviewForm
        form={reviewForm}
        onBack={() => discovery.setStep('discover')}
        isSubmitting={startPending}
        submitError={startError}
      />
    )
  }

  return (
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
  )
}
