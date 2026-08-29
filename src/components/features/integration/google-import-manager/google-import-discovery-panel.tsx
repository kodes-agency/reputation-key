import { AlertCircle, MapPin, Search } from 'lucide-react'
import type {
  ImportAccountDto,
  ImportCandidateDto,
} from '#/contexts/integration/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { GoogleImportAccountList } from './google-import-account-list'
import { GoogleImportCandidateResults } from './google-import-candidate-results'
import { GoogleImportSelectionFooter } from './google-import-selection-footer'

type Props = Readonly<{
  accounts: readonly ImportAccountDto[]
  candidates: readonly ImportCandidateDto[]
  selectedAccountRef: string | null
  selectedIds: ReadonlySet<string>
  search: string
  isLoadingAccounts: boolean
  isLoadingMoreAccounts: boolean
  hasMoreAccounts: boolean
  isLoadingCandidates: boolean
  isLoadingMoreCandidates: boolean
  hasMoreCandidates: boolean
  accountsError: string | null
  candidatesError: string | null
  selectAllError: string | null
  isSelectingAll: boolean
  onSearchChange: (value: string) => void
  onSelectAccount: (accountRef: string) => void
  onToggleCandidate: (candidate: ImportCandidateDto, checked: boolean) => void
  onToggleLoaded: (checked: boolean) => void
  onSelectAllEligible: () => void
  onLoadMoreAccounts: () => void
  onLoadMoreCandidates: () => void
  onReview: () => void
}>

export function GoogleImportDiscoveryPanel(props: Props) {
  const selectedAccount = props.accounts.find(
    (account) => account.accountRef === props.selectedAccountRef,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.34fr)_minmax(0,1fr)]">
      <GoogleImportAccountList
        accounts={props.accounts}
        selectedAccountRef={props.selectedAccountRef}
        isLoading={props.isLoadingAccounts}
        isLoadingMore={props.isLoadingMoreAccounts}
        hasMore={props.hasMoreAccounts}
        error={props.accountsError}
        onSelect={props.onSelectAccount}
        onLoadMore={props.onLoadMoreAccounts}
      />

      <Card className="min-w-0 gap-4">
        <CardHeader>
          <CardTitle>
            {selectedAccount ? selectedAccount.displayName : 'Locations'}
          </CardTitle>
          <CardDescription>
            Search and select locations. Large selections continue in resumable background
            batches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!props.selectedAccountRef ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
              <MapPin className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">Choose a business account</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Its locations will appear here. Provider identifiers stay hidden.
              </p>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={props.search}
                  onChange={(event) => props.onSearchChange(event.currentTarget.value)}
                  placeholder="Search loaded names, addresses, or categories"
                  aria-label="Search loaded Google locations"
                  className="pl-9"
                />
              </div>

              {props.selectAllError ? (
                <Alert>
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Some locations could not be loaded</AlertTitle>
                  <AlertDescription>{props.selectAllError}</AlertDescription>
                </Alert>
              ) : null}

              <GoogleImportCandidateResults
                candidates={props.candidates}
                selectedIds={props.selectedIds}
                isLoading={props.isLoadingCandidates}
                error={props.candidatesError}
                onToggleCandidate={props.onToggleCandidate}
                onToggleLoaded={props.onToggleLoaded}
              />

              <GoogleImportSelectionFooter
                selectedCount={props.selectedIds.size}
                loadedCount={props.candidates.length}
                isLoadingCandidates={props.isLoadingCandidates}
                isLoadingMoreCandidates={props.isLoadingMoreCandidates}
                hasMoreCandidates={props.hasMoreCandidates}
                isSelectingAll={props.isSelectingAll}
                onSelectAllEligible={props.onSelectAllEligible}
                onLoadMoreCandidates={props.onLoadMoreCandidates}
                onReview={props.onReview}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
